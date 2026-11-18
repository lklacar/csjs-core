/* Native WebSocket transport. Game packets never pass through a UDP socket. */
#include "common.h"

#if XASH_WEBSOCKET
#include "netchan.h"
#include "net_ws_private.h"
#include "net_websocket.h"
#include "server.h"
#include <libwebsockets.h>

#define WS_MAX_PEERS 64
#define WS_MAX_PACKETS 128
#define WS_MAX_QUEUED_BYTES (512 * 1024)

typedef struct ws_packet_s
{
	struct ws_packet_s *next;
	netadr_t from;
	size_t length;
	byte data[];
} ws_packet_t;

typedef struct ws_peer_s
{
	struct ws_peer_s *next;
	struct lws *socket;
	netadr_t address;
	size_t received;
	byte incoming[NET_MAX_FRAGMENT];
	ws_packet_t *out_head, *out_tail;
	size_t out_bytes;
	int out_count;
	qboolean closing;
	qboolean local_query;
} ws_peer_t;

static struct lws_context *ws_context;
static ws_peer_t *ws_peers;
static ws_packet_t *ws_in_head, *ws_in_tail;
static int ws_peer_count, ws_in_count;
static size_t ws_in_bytes;
static qboolean ws_stopping;

qboolean NET_WebSocketIsLocalPeer( netadr_t address )
{
	for( const ws_peer_t *peer = ws_peers; peer; peer = peer->next )
	{
		if( NET_CompareAdr( peer->address, address ))
			return peer->local_query && !peer->closing;
	}
	return false;
}

void NET_WebSocketCloseGloballyBannedPeers( void )
{
	for( ws_peer_t *peer = ws_peers; peer; peer = peer->next )
	{
		if( !peer->local_query && SV_GlobalIPBanned( peer->address ))
		{
			peer->closing = true;
			lws_callback_on_writable( peer->socket );
		}
	}
}

static ws_packet_t *WS_Packet( const void *data, size_t length )
{
	ws_packet_t *packet = malloc( sizeof( *packet ) + LWS_PRE + length );
	if( !packet ) return NULL;
	packet->next = NULL;
	packet->length = length;
	memcpy( packet->data + LWS_PRE, data, length );
	return packet;
}

static void WS_RemovePeer( ws_peer_t *peer )
{
	ws_peer_t **link = &ws_peers;
	while( *link && *link != peer ) link = &( *link )->next;
	if( !*link ) return;
	*link = peer->next;
	ws_peer_count--;
	peer->closing = true;

	ws_packet_t **input = &ws_in_head;
	ws_in_tail = NULL;
	while( *input )
	{
		ws_packet_t *packet = *input;
		if( NET_CompareAdr( packet->from, peer->address ))
		{
			*input = packet->next;
			ws_in_count--;
			ws_in_bytes -= packet->length;
			free( packet );
		}
		else
		{
			ws_in_tail = packet;
			input = &packet->next;
		}
	}
	while( peer->out_head )
	{
		ws_packet_t *packet = peer->out_head;
		peer->out_head = packet->next;
		free( packet );
	}
	if( !ws_stopping ) SV_DisconnectWebSocketClient( peer->address );
}

static int WS_Callback( struct lws *socket, enum lws_callback_reasons reason,
	void *user, void *in, size_t length )
{
	ws_peer_t *peer = user;
	switch( reason )
	{
	case LWS_CALLBACK_FILTER_PROTOCOL_CONNECTION:
	{
		char path[16];
		if( ws_peer_count >= WS_MAX_PEERS ||
			lws_hdr_copy( socket, path, sizeof( path ), WSI_TOKEN_GET_URI ) < 0 ||
			strcmp( path, "/ws" )) return -1;
		struct sockaddr_storage address = { 0 };
		socklen_t size = sizeof( address );
		if( getpeername( lws_get_socket_fd( socket ), (struct sockaddr *)&address, &size ) ||
			address.ss_family != AF_INET ) return -1;
		NET_SockadrToNetadr( &address, &peer->address );
		NET_NetadrSetType( &peer->address, NA_WEBSOCKET );
		// Forwarded loopback addresses still belong to external game clients.
		peer->local_query = peer->address.ip4 == htonl( INADDR_LOOPBACK ) &&
			!lws_hdr_total_length( socket, WSI_TOKEN_X_FORWARDED_FOR );

		// Only local Nginx may supply the single, normalized client address.
		if( peer->address.ip4 == htonl( INADDR_LOOPBACK ) && lws_hdr_total_length( socket, WSI_TOKEN_X_FORWARDED_FOR ))
		{
			char forwarded[INET6_ADDRSTRLEN];
			struct in_addr ipv4;
			struct in6_addr ipv6;
			if( lws_hdr_copy( socket, forwarded, sizeof( forwarded ), WSI_TOKEN_X_FORWARDED_FOR ) <= 0 ) return -1;
			if( inet_pton( AF_INET, forwarded, &ipv4 ) == 1 )
				peer->address.ip4 = ipv4.s_addr;
			else if( inet_pton( AF_INET6, forwarded, &ipv6 ) == 1 )
			{
				NET_NetadrSetType( &peer->address, NA_WEBSOCKET6 );
				NET_IP6BytesToNetadr( &peer->address, ipv6.s6_addr );
			}
			else return -1;
		}
		if( !peer->local_query && SV_GlobalIPBanned( peer->address )) return -1;
		break;
	}
	case LWS_CALLBACK_ESTABLISHED:
	{
		if( ws_peer_count >= WS_MAX_PEERS ) return -1;
		peer->socket = socket;
		peer->next = ws_peers;
		ws_peers = peer;
		ws_peer_count++;
		lws_set_timer_usecs( socket, 60 * LWS_USEC_PER_SEC );
		break;
	}
	case LWS_CALLBACK_RECEIVE:
		if( peer->closing ) return -1;
		if( !lws_frame_is_binary( socket ) || length > sizeof( peer->incoming ) - peer->received )
			return -1;
		memcpy( peer->incoming + peer->received, in, length );
		peer->received += length;
		if( !lws_is_final_fragment( socket ) || lws_remaining_packet_payload( socket )) break;
		if( peer->received < 4 ) return -1;
		if( ws_in_count < WS_MAX_PACKETS && peer->received <= WS_MAX_QUEUED_BYTES - ws_in_bytes )
		{
			ws_packet_t *packet = WS_Packet( peer->incoming, peer->received );
			if( !packet ) return -1;
			packet->from = peer->address;
			if( ws_in_tail ) ws_in_tail->next = packet;
			else ws_in_head = packet;
			ws_in_tail = packet;
			ws_in_count++;
			ws_in_bytes += peer->received;
		}
		peer->received = 0;
		lws_set_timer_usecs( socket, 60 * LWS_USEC_PER_SEC );
		break;
	case LWS_CALLBACK_SERVER_WRITEABLE:
		if( peer->closing ) return -1;
		if( peer->out_head )
		{
			ws_packet_t *packet = peer->out_head;
			if( lws_write( socket, packet->data + LWS_PRE, packet->length, LWS_WRITE_BINARY ) != (int)packet->length )
				return -1;
			peer->out_head = packet->next;
			if( !peer->out_head ) peer->out_tail = NULL;
			peer->out_bytes -= packet->length;
			peer->out_count--;
			free( packet );
			if( peer->out_head ) lws_callback_on_writable( socket );
		}
		break;
	case LWS_CALLBACK_TIMER:
		return -1;
	case LWS_CALLBACK_CLOSED:
		WS_RemovePeer( peer );
		break;
	case LWS_CALLBACK_HTTP:
		if( lws_return_http_status( socket, !strcmp( in, "/healthz" ) ? HTTP_STATUS_OK : HTTP_STATUS_NOT_FOUND, NULL ))
			return -1;
		return lws_http_transaction_completed( socket );
	default:
		break;
	}
	return 0;
}

static const struct lws_protocols ws_protocols[] = {
	{
		.name = "csjs",
		.callback = WS_Callback,
		.per_session_data_size = sizeof( ws_peer_t ),
		.rx_buffer_size = NET_MAX_FRAGMENT,
	},
	{ 0 }
};

qboolean NET_WebSocketInit( const char *interface, int port )
{
	struct lws_context_creation_info info = { 0 };
	if( ws_context || !port ) return true;
	if( port < 0 || port > 65535 ) return false;
	info.port = port;
	info.iface = !strcmp( interface, "localhost" ) ? NULL : interface;
	info.protocols = ws_protocols;
	// Nginx connects over IPv4 loopback; forwarded client addresses may be IPv4 or IPv6.
	info.options = LWS_SERVER_OPTION_DISABLE_IPV6;
	info.fd_limit_per_thread = WS_MAX_PEERS + 16;
	info.timeout_secs = 5;
	lws_set_log_level( LLL_ERR | LLL_WARN, NULL );
	ws_stopping = false;
	ws_context = lws_create_context( &info );
	if( !ws_context ) return false;
	Con_Printf( "Native WebSocket listener: %s:%d/ws\n", info.iface ? info.iface : "0.0.0.0", port );
	return true;
}

void NET_WebSocketShutdown( void )
{
	if( !ws_context ) return;
	ws_stopping = true;
	lws_context_destroy( ws_context );
	ws_context = NULL;
	while( ws_in_head )
	{
		ws_packet_t *packet = ws_in_head;
		ws_in_head = packet->next;
		free( packet );
	}
	ws_in_tail = NULL;
	ws_in_count = 0;
	ws_in_bytes = 0;
}

void NET_WebSocketPoll( void )
{
	if( !ws_context ) return;
	// lws_service ignores its timeout; queue a wakeup so the game thread never waits.
	lws_cancel_service( ws_context );
	if( lws_service( ws_context, 0 ) < 0 ) Host_Error( "WebSocket service failed\n" );
}

qboolean NET_WebSocketReceive( netadr_t *from, byte *data, size_t *length )
{
	ws_packet_t *packet = ws_in_head;
	if( !packet ) return false;
	ws_in_head = packet->next;
	if( !ws_in_head ) ws_in_tail = NULL;
	ws_in_count--;
	ws_in_bytes -= packet->length;
	*from = packet->from;
	*length = packet->length;
	memcpy( data, packet->data + LWS_PRE, packet->length );
	free( packet );
	return true;
}

void NET_WebSocketSend( netadr_t to, const void *data, size_t length )
{
	if( !length || length > NET_MAX_FRAGMENT ) return;
	for( ws_peer_t *peer = ws_peers; peer; peer = peer->next )
	{
		if( !NET_CompareAdr( peer->address, to ) || peer->closing ) continue;
		ws_packet_t *packet = NULL;
		if( peer->out_count < WS_MAX_PACKETS && length <= WS_MAX_QUEUED_BYTES - peer->out_bytes )
			packet = WS_Packet( data, length );
		if( !packet ) peer->closing = true;
		else
		{
			if( peer->out_tail ) peer->out_tail->next = packet;
			else peer->out_head = packet;
			peer->out_tail = packet;
			peer->out_count++;
			peer->out_bytes += length;
		}
		lws_callback_on_writable( peer->socket );
		return;
	}
}
#endif
