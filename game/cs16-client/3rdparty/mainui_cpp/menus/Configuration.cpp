/*
Copyright (C) 1997-2001 Id Software, Inc.

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  

See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA  02111-1307, USA.

*/

#include "Framework.h"
#include "Bitmap.h"
#include "PicButton.h"
#include "YesNoMessageBox.h"
#include "keydefs.h"
#include "TabView.h"

#define ART_BANNER	     	"gfx/shell/head_config"

#ifdef __EMSCRIPTEN__
void UI_PlayerSettings_Menu();
#endif

class CMenuOptions: public CMenuFramework
{
private:
	void _Init( void ) override;

public:
	typedef CMenuFramework BaseClass;
	CMenuOptions() : CMenuFramework("CMenuOptions") { }

	// update dialog
	CMenuYesNoMessageBox msgBox;
};

/*
=================
CMenuOptions::Init
=================
*/
void CMenuOptions::_Init( void )
{
#ifdef __EMSCRIPTEN__
	UseSettingsPanel( L( "GameUI_Options" ), L( "Choose a category to adjust your game." ) );
	AddButton( L( "Player settings" ), L( "Crosshair, spraypaint and player preferences" ),
		PC_CUSTOMIZE, UI_PlayerSettings_Menu, QMF_NOTIFY )->SetRect( 106, 218, 812, 66 );
	AddButton( L( "Controls" ), L( "Key bindings, mouse, touch and gamepad" ),
		PC_CONTROLS, UI_Controls_Menu, QMF_NOTIFY )->SetRect( 106, 296, 812, 66 );
	AddButton( L( "GameUI_Audio" ), L( "Volume, sound effects and vibration" ),
		PC_AUDIO, UI_Audio_Menu, QMF_NOTIFY )->SetRect( 106, 374, 812, 66 );
	AddButton( L( "GameUI_Video" ), L( "Brightness, image quality and display mode" ),
		PC_VIDEO, UI_Video_Menu, QMF_NOTIFY )->SetRect( 106, 452, 812, 66 );
	AddButton( L( "Back" ), nullptr, PC_DONE, VoidCb( &CMenuOptions::Hide ) )->SetRect( 770, 564, 148, 42 );
#else
	banner.SetPicture( ART_BANNER );

	msgBox.SetMessage( L( "Check the Internet for updates?" ) );
	SET_EVENT( msgBox.onPositive, UI_OpenUpdatePage( false, true ) );

	msgBox.Link( this );

	AddItem( banner );
	AddButton( L( "Controls" ), L( "Change keyboard, mouse, touch and joystick settings." ),
		PC_CONTROLS, UI_Controls_Menu, QMF_NOTIFY );
	AddButton( L( "GameUI_Audio" ), L( "Change sound volume and quality." ),
		PC_AUDIO, UI_Audio_Menu, QMF_NOTIFY );
	AddButton( L( "GameUI_Video" ), L( "Change screen size, video mode, gamme and glare reduction." ),
		PC_VIDEO, UI_Video_Menu, QMF_NOTIFY );
	AddButton( L( "Done" ), L( "Go back to the Main Menu." ),
		PC_DONE, VoidCb( &CMenuOptions::Hide ), QMF_NOTIFY );
#endif
}

ADD_MENU( menu_options, CMenuOptions, UI_Options_Menu );
