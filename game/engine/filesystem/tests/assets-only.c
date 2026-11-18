#include "filesystem_test_common.h"

int main( void )
{
	const char *const files[] = { "map.bsp", "texture.wad", "server.cfg", "gameinfo.txt", "plugin.amxx", "mapcycle.txt" };
	if( !LoadFilesystem() )
	{
		return EXIT_FAILURE;
	}
	for( size_t i = 0; i < sizeof( files ) / sizeof( files[0] ); i++ )
	{
		FILE *file = fopen( files[i], "wb" );
		if( !file ) { return EXIT_FAILURE; }
		fputs( "fixture", file );
		fclose( file );
	}
	g_fs.AddGameDirectory( "./", FS_ASSETS_ONLY | FS_NOWRITE_PATH | FS_GAMERODIR_PATH );
	for( size_t i = 0; i < sizeof( files ) / sizeof( files[0] ); i++ )
	{
		if( !!g_fs.FileExists( files[i], false ) != ( i < 2 ))
		{
			fprintf( stderr, "Asset filter failed: %s\n", files[i] );
			return EXIT_FAILURE;
		}
	}
	search_t *scripts = g_fs.Search( "*.cfg", true, false );
	if( scripts && scripts->numfilenames ) { return EXIT_FAILURE; }
	free( scripts );
	search_t *maps = g_fs.Search( "*.bsp", true, false );
	if( !maps || maps->numfilenames != 1 ) { return EXIT_FAILURE; }
	free( maps );
	g_fs.ShutdownStdio();
	for( size_t i = 0; i < sizeof( files ) / sizeof( files[0] ); i++ ) { remove( files[i] ); }
	return EXIT_SUCCESS;
}
