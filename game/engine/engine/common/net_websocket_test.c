#include "common.h"
#include "tests.h"

#if XASH_ENGINE_TESTS && XASH_WEBSOCKET
#include "netchan.h"
#include "net_websocket.h"
#include "net_ws_private.h"
#include "server.h"
#include <libwebsockets.h>

typedef struct
{
	struct lws *socket;
	const char *forwarded;
	const char *expected_reply;
	qboolean connected, closed;
	int replies, fragment;
	enum lws_write_protocol mode;
	size_t length;
	byte data[LWS_PRE + NET_MAX_FRAGMENT + 1];
} ws_test_client_t;

static int WS_TestCallback( struct lws *socket, enum lws_callback_reasons reason,
	void *user, void *in, size_t length )
{
	ws_test_client_t *client = user;
	switch( reason )
	{
	case LWS_CALLBACK_CLIENT_APPEND_HANDSHAKE_HEADER:
		if( client->forwarded )
		{
			unsigned char **headers = in;
			return lws_add_http_header_by_token( socket, WSI_TOKEN_X_FORWARDED_FOR,
				(const unsigned char *)client->forwarded, strlen( client->forwarded ), headers, *headers + length );
		}
		break;
	case LWS_CALLBACK_CLIENT_ESTABLISHED:
		client->connected = true;
		break;
	case LWS_CALLBACK_CLIENT_RECEIVE:
		TASSERT_EQi( length, strlen( client->expected_reply ? client->expected_reply : "testgame" ));
		TASSERT( !memcmp( in, client->expected_reply ? client->expected_reply : "testgame", length ));
		client->replies++;
		break;
	case LWS_CALLBACK_CLIENT_WRITEABLE:
		if( client->fragment == 1 )
		{
			TASSERT_EQi( lws_write( socket, client->data + LWS_PRE, 3, LWS_WRITE_BINARY | LWS_WRITE_NO_FIN ), 3 );
			client->fragment = 2;
			lws_callback_on_writable( socket );
		}
		else if( client->fragment == 2 )
		{
			TASSERT_EQi( lws_write( socket, client->data + LWS_PRE + 3, 5, LWS_WRITE_CONTINUATION ), 5 );
			client->fragment = 0;
		}
		else TASSERT_EQi( lws_write( socket, client->data + LWS_PRE, client->length, client->mode ), client->length );
		break;
	case LWS_CALLBACK_CLIENT_CLOSED:
	case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
		if( client ) client->closed = true;
		break;
	default:
		break;
	}
	return 0;
}

static void WS_TestConnect( struct lws_context *context, ws_test_client_t *client, const char *path,
	const char *forwarded, const char *source )
{
	struct lws_client_connect_info info = { 0 };
	memset( client, 0, sizeof( *client ));
	client->forwarded = forwarded;
	info.iface = source;
	info.context = context;
	info.address = "127.0.0.1";
	info.port = 27016;
	info.path = path;
	info.host = "127.0.0.1";
	info.local_protocol_name = "test";
	info.userdata = client;
	client->socket = lws_client_connect_via_info( &info );
	TASSERT( client->socket != NULL );
}

static void WS_TestPump( struct lws_context *context, const qboolean *done, int *packets, netadr_t *last )
{
	byte data[NET_MAX_FRAGMENT];
	size_t length;
	double deadline = Platform_DoubleTime() + 2;
	while( !*done && Platform_DoubleTime() < deadline )
	{
		lws_cancel_service( context );
		lws_service( context, 0 );
		while( NET_GetPacket( NS_SERVER, last, data, &length ))
		{
			TASSERT_EQi( length, 8 );
			TASSERT( !memcmp( data, "testgame", 8 ));
			( *packets )++;
			NET_SendPacket( NS_SERVER, length, data, *last );
		}
		Platform_Sleep( 1 );
	}
	TASSERT( *done );
}

static void WS_TestSend( ws_test_client_t *client, enum lws_write_protocol mode, size_t length, qboolean fragmented )
{
	memcpy( client->data + LWS_PRE, "testgame", 8 );
	client->mode = mode;
	client->length = length;
	client->fragment = fragmented ? 1 : 0;
	lws_callback_on_writable( client->socket );
}

static void WS_TestForwardedAddress( struct lws_context *context, const char *forwarded,
	const char *source, const char *expected )
{
	ws_test_client_t client;
	int packets = 0;
	netadr_t address = { 0 };
	WS_TestConnect( context, &client, "/ws", forwarded, source );
	if( !expected )
	{
		WS_TestPump( context, &client.closed, &packets, &address );
		TASSERT( !client.connected );
		return;
	}
	WS_TestPump( context, &client.connected, &packets, &address );
	WS_TestSend( &client, LWS_WRITE_BINARY, 8, false );
	double deadline = Platform_DoubleTime() + 2;
	while( !client.replies && Platform_DoubleTime() < deadline )
	{
		byte data[NET_MAX_FRAGMENT];
		size_t length;
		lws_cancel_service( context );
		lws_service( context, 0 );
		if( NET_GetPacket( NS_SERVER, &address, data, &length ))
		{
			TASSERT( !strcmp( NET_BaseAdrToString( address ), expected ));
			TASSERT_EQi( NET_WebSocketIsLocalPeer( address ), !forwarded && !source );
			NET_SendPacket( NS_SERVER, length, data, address );
			packets++;
		}
		Platform_Sleep( 1 );
	}
	TASSERT_EQi( packets, 1 );
	TASSERT_EQi( client.replies, 1 );
	netadr_t udp = address, other_port = address;
	NET_NetadrSetType( &udp, strchr( expected, ':' ) ? NA_IP6 : NA_IP );
	TASSERT( !NET_CompareAdr( address, udp ));
	TASSERT( NET_CompareAdrByMask( address, udp, strchr( expected, ':' ) ? 128 : 32 ));
	other_port.port++;
	TASSERT( !NET_CompareBaseAdr( address, other_port ));
	lws_set_timeout( client.socket, PENDING_TIMEOUT_CLOSE_SEND, LWS_TO_KILL_ASYNC );
	WS_TestPump( context, &client.closed, &packets, &address );
}

static void WS_TestGlobalBanReload( struct lws_context *context, const char *forwarded )
{
	static const char command[] = "\xff\xff\xff\xff" "csjs_global_bans_reload";
	ws_test_client_t client;
	int packets = 0;
	netadr_t address = { 0 };
	WS_TestConnect( context, &client, "/ws", forwarded, NULL );
	WS_TestPump( context, &client.connected, &packets, &address );
	// No cache path is configured in this test, so an authorized reload reports failure.
	client.expected_reply = "\xff\xff\xff\xff" "csjs_global_bans_error";
	memcpy( client.data + LWS_PRE, command, sizeof( command ));
	client.length = sizeof( command );
	client.mode = LWS_WRITE_BINARY;
	lws_callback_on_writable( client.socket );
	double deadline = Platform_DoubleTime() + ( forwarded ? 0.2 : 2 );
	while( !client.replies && Platform_DoubleTime() < deadline )
	{
		byte data[NET_MAX_FRAGMENT];
		size_t length;
		lws_cancel_service( context );
		lws_service( context, 0 );
		while( NET_GetPacket( NS_SERVER, &address, data, &length ))
		{
			sizebuf_t message;
			MSG_Init( &message, "GlobalBanReload", data, length );
			SV_ConnectionlessPacket( address, &message );
			packets++;
		}
		Platform_Sleep( 1 );
	}
	TASSERT_EQi( packets, 1 );
	TASSERT_EQi( client.replies, forwarded ? 0 : 1 );
	lws_set_timeout( client.socket, PENDING_TIMEOUT_CLOSE_SEND, LWS_TO_KILL_ASYNC );
	WS_TestPump( context, &client.closed, &packets, &address );
}

void Test_RunWebSocket( void )
{
	static const struct lws_protocols protocols[] = {
		{ .name = "test", .callback = WS_TestCallback, .rx_buffer_size = NET_MAX_FRAGMENT }, { 0 }
	};
	struct lws_context_creation_info info = { 0 };
	static ws_test_client_t first, second, invalid;
	int packets = 0;
	netadr_t address = { 0 }, first_address = { 0 }, udp_address;

	NET_Init();
	NET_Config( true, false );
	info.port = CONTEXT_PORT_NO_LISTEN;
	info.protocols = protocols;
	struct lws_context *context = lws_create_context( &info );
	TASSERT( context != NULL );
	if( !context ) { NET_Shutdown(); return; }

	WS_TestConnect( context, &first, "/ws", "198.51.100.7", NULL );
	WS_TestConnect( context, &second, "/ws", "198.51.100.7", NULL );
	WS_TestPump( context, &first.connected, &packets, &address );
	WS_TestPump( context, &second.connected, &packets, &address );
	WS_TestSend( &first, LWS_WRITE_BINARY, 8, true );
	qboolean replied = false;
	double deadline = Platform_DoubleTime() + 2;
	while( !first.replies && Platform_DoubleTime() < deadline )
	{
		lws_cancel_service( context );
		lws_service( context, 0 );
		NET_WebSocketPoll();
		byte data[NET_MAX_FRAGMENT];
		size_t length;
		if( NET_GetPacket( NS_SERVER, &address, data, &length ))
		{
			TASSERT_EQi( length, 8 );
			TASSERT( !memcmp( data, "testgame", 8 ));
			TASSERT_EQi( NET_NetadrType( &address ), NA_WEBSOCKET );
			TASSERT( !strcmp( NET_BaseAdrToString( address ), "198.51.100.7" ));
			first_address = address;
			packets++;
			NET_SendPacket( NS_SERVER, length, data, address );
		}
		Platform_Sleep( 1 );
	}
	replied = first.replies == 1;
	TASSERT( replied );
	TASSERT_EQi( packets, 1 );
	TASSERT_EQi( second.replies, 0 );

	// UDP and WebSocket peers must stay distinct, while IPv4 bans cover both.
	udp_address = first_address;
	NET_NetadrSetType( &udp_address, NA_IP );
	TASSERT( !NET_WebSocketIsLocalPeer( udp_address ));
	TASSERT( !NET_CompareAdr( first_address, udp_address ));
	TASSERT( !NET_CompareBaseAdr( first_address, udp_address ));
	TASSERT( NET_CompareAdrByMask( first_address, udp_address, 32 ));
	address = first_address;
	address.port++;
	TASSERT( !NET_CompareBaseAdr( first_address, address ));

	WS_TestSend( &second, LWS_WRITE_TEXT, 8, false );
	WS_TestPump( context, &second.closed, &packets, &address );
	TASSERT_EQi( packets, 1 );
	WS_TestConnect( context, &second, "/ws", "198.51.100.7", NULL );
	WS_TestPump( context, &second.connected, &packets, &address );
	WS_TestSend( &second, LWS_WRITE_BINARY, NET_MAX_FRAGMENT + 1, false );
	WS_TestPump( context, &second.closed, &packets, &address );
	TASSERT_EQi( packets, 1 );
	WS_TestConnect( context, &invalid, "/wrong-path", NULL, NULL );
	WS_TestPump( context, &invalid.closed, &packets, &address );
	TASSERT( !invalid.connected );

	// Slow readers must be disconnected instead of growing an unbounded queue.
	for( int i = 0; i < 129; i++ ) NET_SendPacket( NS_SERVER, 8, "testgame", first_address );
	WS_TestPump( context, &first.closed, &packets, &address );
	WS_TestForwardedAddress( context, NULL, NULL, "127.0.0.1" );
	WS_TestForwardedAddress( context, "203.0.113.9", NULL, "203.0.113.9" );
	WS_TestForwardedAddress( context, "2001:db8::9", NULL, "2001:db8::9" );
	WS_TestForwardedAddress( context, "127.0.0.1", NULL, "127.0.0.1" );
	WS_TestForwardedAddress( context, NULL, "127.0.0.2", "127.0.0.2" );
	WS_TestForwardedAddress( context, "203.0.113.9", "127.0.0.2", "127.0.0.2" );
	WS_TestForwardedAddress( context, "203.0.113.9, 198.51.100.7", NULL, NULL );
	WS_TestForwardedAddress( context, "not-an-ip", NULL, NULL );
	WS_TestForwardedAddress( context, "2001:0db8:0000:0000:0000:0000:0000:0009-too-long", NULL, NULL );
	// Installing a global ban closes every matching socket and blocks new handshakes.
	WS_TestConnect( context, &first, "/ws", "198.51.100.7", NULL );
	WS_TestConnect( context, &second, "/ws", "198.51.100.7", NULL );
	WS_TestPump( context, &first.connected, &packets, &address );
	WS_TestPump( context, &second.connected, &packets, &address );
	TASSERT( Test_ApplyGlobalIPBans( "CSJS_GLOBAL_IP_BANS_V1 3\n0\t198.51.100.7\n0\t2001:db8::9\n0\t127.0.0.1\n" ));
	WS_TestPump( context, &first.closed, &packets, &address );
	WS_TestPump( context, &second.closed, &packets, &address );
	WS_TestForwardedAddress( context, "198.51.100.7", NULL, NULL );
	WS_TestForwardedAddress( context, "::ffff:198.51.100.7", NULL, NULL );
	WS_TestForwardedAddress( context, "2001:db8::9", NULL, NULL );
	WS_TestForwardedAddress( context, "127.0.0.1", NULL, NULL );
	WS_TestForwardedAddress( context, NULL, NULL, "127.0.0.1" );
	TASSERT( Test_ApplyGlobalIPBans( "CSJS_GLOBAL_IP_BANS_V1 1\n1\t198.51.100.7\n" ));
	WS_TestForwardedAddress( context, "198.51.100.7", NULL, "198.51.100.7" );
	TASSERT( Test_ApplyGlobalIPBans( "CSJS_GLOBAL_IP_BANS_V1 0\n" ));
	WS_TestForwardedAddress( context, "2001:db8::9", NULL, "2001:db8::9" );
	WS_TestGlobalBanReload( context, NULL );
	WS_TestGlobalBanReload( context, "127.0.0.1" );
	lws_context_destroy( context );
	NET_Shutdown();
}
#elif XASH_ENGINE_TESTS
void Test_RunWebSocket( void ) {}
#endif
