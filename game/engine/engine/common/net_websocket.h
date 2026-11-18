#ifndef NET_WEBSOCKET_H
#define NET_WEBSOCKET_H

#if XASH_WEBSOCKET
qboolean NET_WebSocketInit( const char *interface, int port );
void NET_WebSocketShutdown( void );
void NET_WebSocketCloseGloballyBannedPeers( void );
void NET_WebSocketPoll( void );
qboolean NET_WebSocketReceive( netadr_t *from, byte *data, size_t *length );
void NET_WebSocketSend( netadr_t to, const void *data, size_t length );
qboolean NET_WebSocketIsLocalPeer( netadr_t address );
#endif

#endif
