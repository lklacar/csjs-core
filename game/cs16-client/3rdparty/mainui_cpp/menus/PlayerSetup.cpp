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
#include "CheckBox.h"
#include "Slider.h"
#include "Field.h"
#include "SpinControl.h"
#include "YesNoMessageBox.h"
#include "PlayerModelView.h"
#include "StringVectorModel.h"
#include "ColorPickerDialog.h"
#ifdef __EMSCRIPTEN__
#include "ClassicCrosshair.h"
#endif

#define ART_BANNER		"gfx/shell/head_customize"

class CMenuPlayerSetup : public CMenuFramework
{
private:
	void _Init() override;
protected:
	void Reload() override;
public:
	explicit CMenuPlayerSetup( const char *windowName = "CMenuPlayerSetup" ) : CMenuFramework( windowName ), msgBox( true ) { }

	void SetConfig();
	void UpdateModel();
	void UpdateLogo();
	void ApplyColorToImagePreview();
	void ApplyColorToLogoPreview();
	bool WriteNewLogo();
	void InitLogoControls( int x, int y, int width, int height );
	void ShowColorPicker();
	void OnColorPickerOk();
	void SaveAndPopMenu() override;

	class CModelListModel : public CStringVectorModel
	{
	public:
		void Update() override;
	} modelsModel;

	class CLogosListModel : public CStringVectorModel
	{
	public:
		void Update() override;

		const char *GetPath( int pos ) const { return m_logoPaths[pos].String(); }

		bool IsPng( int pos )
		{
			return m_logoPaths[pos].BEndsWithCaseless( ".png" );
		}

	private:
		CUtlVector<CUtlString> m_logoPaths;
	} logosModel;

	CMenuPlayerModelView	view;

	CMenuCheckBox showModels;
	CMenuCheckBox hiModels;

	CMenuCheckBox voiceEnable;
	CMenuSlider transmitVolume;
	CMenuSlider receiveVolume;
	CMenuAction noProprietaryCodecNotice;

	CMenuSlider	topColor;
	CMenuSlider	bottomColor;

	CMenuField	name;
	CMenuSpinControl	model;

	class CMenuLogoPreview : public CMenuBaseItem
	{
	public:
		virtual void Draw();
		HIMAGE hImage;
		const byte ( *stripes )[3];
		int stripeCount;
		bool colorable;
		const bool *horizontal;
	} logoImage;

	CMenuSpinControl	logo;
	CMenuPicButton		btnChooseColor;
	CMenuColorPickerDialog	colorPickerDlg;
	byte			m_stripes[MAX_LOGO_STRIPES][3];
	int			m_stripeCount;
	bool			m_horizontal;
	bool			m_logoColorable;

	void ParseLogoColorCvar();
	void WriteLogoColorCvar();

	CMenuYesNoMessageBox msgBox;

	bool hideModels, hideLogos;
};

void CMenuPlayerSetup::CMenuLogoPreview::Draw()
{
	if( !hImage )
	{
		// draw the background
		UI_FillRect( m_scPos, m_scSize, uiPromptBgColor );

		UI_DrawString( font, m_scPos, m_scSize, L( "No logo" ), colorBase, m_scChSize, QM_CENTER, ETF_SHADOW );
	}
	else if( !colorable || stripeCount <= 1 )
	{
		byte r = colorable ? stripes[0][0] : 255;
		byte g = colorable ? stripes[0][1] : 255;
		byte b = colorable ? stripes[0][2] : 255;
		EngFuncs::PIC_Set( hImage, r, g, b );
		EngFuncs::PIC_DrawTrans( m_scPos, m_scSize );
	}
	else
	{
		const Size img_sz = EngFuncs::PIC_Size( hImage );
		const bool hz = horizontal && *horizontal;

		const double tex_per_stripe = ( hz ? img_sz.w  : img_sz.h  ) / (double)stripeCount;
		const double scr_per_stripe = ( hz ? m_scSize.w : m_scSize.h ) / (double)stripeCount;

		for( int i = 0; i < stripeCount; i++ )
		{
			int scr_start = (int)( i * scr_per_stripe + 0.5 );
			int scr_next  = (int)(( i + 1 ) * scr_per_stripe + 0.5 );
			int tex_start = (int)( i * tex_per_stripe + 0.5 );
			int tex_next  = (int)(( i + 1 ) * tex_per_stripe + 0.5 );

			wrect_t rc = {};
			if( hz )
			{
				rc.left   = tex_start;
				rc.right  = tex_next;
				rc.bottom = img_sz.h;
			}
			else
			{
				rc.right  = img_sz.w;
				rc.top    = tex_start;
				rc.bottom = tex_next;
			}

			Point ui_pt = hz ? Point( m_scPos.x + scr_start, m_scPos.y ) : Point( m_scPos.x, m_scPos.y + scr_start );
			Size  ui_sz = hz ? Size( scr_next - scr_start, m_scSize.h ) : Size( m_scSize.w, scr_next - scr_start );

			EngFuncs::PIC_Set( hImage, stripes[i][0], stripes[i][1], stripes[i][2] );
			EngFuncs::PIC_DrawTrans( ui_pt, ui_sz, &rc );
		}
	}

	int textHeight = m_scPos.y - (m_scChSize * 1.5f);
	uint textflags = ( iFlags & QMF_DROPSHADOW ) ? ETF_SHADOW : 0;
	UI_DrawString( font, m_scPos.x, textHeight, m_scSize.w, m_scChSize, szName, uiColorHelp, m_scChSize, QM_LEFT, textflags | ETF_FORCECOL | ETF_NOSIZELIMIT );

	// draw the rectangle
	if( eFocusAnimation == QM_HIGHLIGHTIFFOCUS && IsCurrentSelected() )
		UI_DrawRectangle( m_scPos, m_scSize, uiInputTextColor );
	else
		UI_DrawRectangle( m_scPos, m_scSize, uiInputFgColor );

}

/*
=================
UI_PlayerSetup_FindModels
=================
*/
void CMenuPlayerSetup::CModelListModel::Update( void )
{
	char	**filenames;
	int numFiles, i;

	RemoveAll();

	// Get file list
	// search in basedir too, because that's how GoldSrc does this
	filenames = EngFuncs::GetFilesList(  "models/player/*", &numFiles, false );

	// build the model list
	for( i = 0; i < numFiles; i++ )
	{
		char name[128], path[512];
		COM_FileBase( filenames[i], name, sizeof( name ));

		// check if the path is a valid model
		snprintf( path, sizeof( path ), "models/player/%s/%s.mdl", name, name );
		if( !EngFuncs::FileExists( path ))
			continue;

		AddToTail( name );
	}
}

/*
=================
CMenuPlayerSetup::FindLogos

=================
*/
void CMenuPlayerSetup::CLogosListModel::Update( )
{
	char	**filenames;
	int numFiles, i;

	m_logoPaths.RemoveAll();
	RemoveAll();

	// Get file list
	filenames = EngFuncs::GetFilesList( "logos/*.*", &numFiles, false );

	// build the model list
	for( i = 0; i < numFiles; i++ )
	{
		CUtlString logoFileName = filenames[i];
		char temp[256];
		bool png = logoFileName.BEndsWithCaseless( ".png" );

		if( png || logoFileName.BEndsWithCaseless( ".bmp" ))
		{
			COM_FileBase( logoFileName.String(), temp, sizeof( temp ));

			if( !stricmp( temp, "remapped" ))
				continue;

			AddToTail( temp );
			m_logoPaths.AddToTail( logoFileName );
		}
	}
}

/*
=================
UI_PlayerSetup_SetConfig
=================
*/
void CMenuPlayerSetup::SetConfig( void )
{
	name.WriteCvar();
	model.WriteCvar();
	topColor.WriteCvar();
	bottomColor.WriteCvar();
	hiModels.WriteCvar();
	showModels.WriteCvar();
	WriteNewLogo();
}

void CMenuPlayerSetup::SaveAndPopMenu()
{
	if( !UI::Names::CheckIsNameValid( name.GetBuffer() ) )
	{
		msgBox.Show();
		return;
	}

	SetConfig();
	CMenuFramework::SaveAndPopMenu();
}

void CMenuPlayerSetup::UpdateModel()
{
	char image[256];
	const char *mdl = model.GetCurrentString();

	// seems we DON'T have this model locally
	// just force display string and do nothing
	if( !mdl )
	{
		model.ForceDisplayString( EngFuncs::GetCvarString( "model" ));
		return;
	}

	snprintf( image, sizeof( image ), "models/player/%s/%s.bmp", mdl, mdl );
	view.hPlayerImage = EngFuncs::PIC_Load( image, PIC_KEEP_SOURCE );
	ApplyColorToImagePreview();

	EngFuncs::CvarSetString( "model", mdl );
	if( !strcmp( mdl, "player" ))
		strcpy( image, "models/player.mdl" );
	else
		snprintf( image, sizeof( image ), "models/player/%s/%s.mdl", mdl, mdl );

	if( view.ent )
		EngFuncs::SetModel( view.ent, image );
}

void CMenuPlayerSetup::UpdateLogo()
{
	const int pos = logo.GetCurrentValue();
	bool colorable = false;

	if( pos < 0 || pos >= logosModel.GetRows() )
	{
		logoImage.hImage = 0;
	}
	else
	{
		const char *filename = logosModel.GetPath( pos );
		if( logosModel.IsPng( pos ) )
		{
			logoImage.hImage = EngFuncs::PIC_Load( filename, 0 );
		}
		else
		{
			CBMP *bmpFile = CBMP::LoadFile( filename );
			colorable = bmpFile && bmpFile->GetBitmapHdr()->bitsPerPixel == 8;
			if( colorable )
			{
				// The decal loader derives opacity from the palette index for #logo textures.
				char previewName[256];
				snprintf( previewName, sizeof( previewName ), "#logo/%s", filename );
				logoImage.hImage = bmpFile->Upload( previewName );
			}
			else
			{
				logoImage.hImage = EngFuncs::PIC_Load( filename, 0 );
			}
			delete bmpFile;
		}
	}

	m_logoColorable    = colorable;
	logoImage.colorable    = m_logoColorable;
	logoImage.stripes      = m_stripes;
	logoImage.stripeCount  = m_stripeCount;
	logoImage.horizontal   = &m_horizontal;

	btnChooseColor.SetGrayed( !m_logoColorable );
}

void CMenuPlayerSetup::ShowColorPicker()
{
	if( !m_logoColorable )
		return;

	colorPickerDlg.Show( m_stripes, m_stripeCount, m_horizontal, logoImage.hImage );
}

void CMenuPlayerSetup::OnColorPickerOk()
{
	colorPickerDlg.GetStripes( m_stripes, m_stripeCount, m_horizontal );
	ApplyColorToLogoPreview();
}

void CMenuPlayerSetup::ApplyColorToImagePreview()
{
	EngFuncs::ProcessImage( view.hPlayerImage, -1,
		topColor.GetCurrentValue(), bottomColor.GetCurrentValue() );
}

void CMenuPlayerSetup::ApplyColorToLogoPreview()
{
	logoImage.colorable = m_logoColorable;
	logoImage.stripes = m_stripes;
	logoImage.stripeCount = m_stripeCount;
	logoImage.horizontal = &m_horizontal;
}

void CMenuPlayerSetup::ParseLogoColorCvar()
{
	m_stripeCount = 1;
	m_stripes[0][0] = m_stripes[0][1] = m_stripes[0][2] = 255;

	const char *logoColor = EngFuncs::GetCvarString( "cl_logocolor" );
	if( !logoColor || !*logoColor )
		return;

	int parsed = 0;
	const char *p = logoColor;
	while( parsed < MAX_LOGO_STRIPES )
	{
		int r, g, b, n = 0;
		while( *p == ' ' || *p == '\t' || *p == ',' )
			p++;
		if( !*p )
			break;
		if( sscanf( p, "%d %d %d%n", &r, &g, &b, &n ) != 3 || n <= 0 )
			break;
		m_stripes[parsed][0] = (byte)Q_max( 0, Q_min( 255, r ));
		m_stripes[parsed][1] = (byte)Q_max( 0, Q_min( 255, g ));
		m_stripes[parsed][2] = (byte)Q_max( 0, Q_min( 255, b ));
		parsed++;
		p += n;
	}

	if( parsed > 0 )
		m_stripeCount = parsed;
}

void CMenuPlayerSetup::WriteLogoColorCvar()
{
	CUtlString s;
	for( int i = 0; i < m_stripeCount; i++ )
	{
		if( i > 0 )
			s += " ";
		CUtlString triple;
		triple.Format( "%d %d %d", m_stripes[i][0], m_stripes[i][1], m_stripes[i][2] );
		s += triple;
	}
	EngFuncs::CvarSetString( "cl_logocolor", s.String() );
}

bool CMenuPlayerSetup::WriteNewLogo( void )
{
	int pos = logo.GetCurrentValue();

	if( pos < 0 || hideLogos )
		return true;
	if( pos >= logosModel.GetRows() )
		return false;
	const char *filename = logosModel.GetPath( pos );

	// TODO: check file size and throw a messagebox if it's too big?
	if( logosModel.IsPng( pos ))
	{
		int len = 0;
		void *afile = EngFuncs::COM_LoadFile( filename, &len );
		if( !afile )
			return false;
		const bool saved = EngFuncs::COM_SaveFile( "logos/remapped.png", afile, len );
		EngFuncs::COM_FreeFile( afile );
		if( !saved )
			return false;

		EngFuncs::CvarSetString( "cl_logoext", "png" );
	}
	else
	{
		CBMP *bmpFile = CBMP::LoadFile( filename );

		// not valid logo BMP file
		if( !bmpFile )
			return false;

		// remap logo if needed
		if( m_logoColorable )
			bmpFile->RemapLogo( m_stripeCount, &m_stripes[0][0], m_horizontal );

		const bool saved = bmpFile->Save( "logos/remapped.bmp" );
		delete bmpFile;
		if( !saved )
			return false;
		EngFuncs::CvarSetString( "cl_logoext", "bmp" );
	}

	if( m_logoColorable )
	{
		WriteLogoColorCvar();
		EngFuncs::CvarSetValue( "ui_logohorizontal", m_horizontal ? 1.f : 0.f );
	}

	logo.WriteCvar();

	EngFuncs::CvarSetValue( "@cl_logoupdate", !EngFuncs::GetCvarFloat( "@cl_logoupdate" ));
	return true;
}

void CMenuPlayerSetup::InitLogoControls( int x, int y, int width, int height )
{
	logosModel.Update();
	hideLogos = !logosModel.GetRows();
	if( hideLogos )
		return;

	ParseLogoColorCvar();
	m_horizontal = EngFuncs::GetCvarFloat( "ui_logohorizontal" ) != 0.f;
	logoImage.szName = L( "GameUI_SpraypaintImage" );
	logoImage.SetRect( x, y, width, height );
	logo.Setup( &logosModel );
	logo.LinkCvar( "cl_logofile", CMenuEditable::CVAR_STRING );
	logo.onChanged = VoidCb( &CMenuPlayerSetup::UpdateLogo );
	logo.SetRect( x, y + height + UI_OUTLINE_WIDTH, width, 32 );
	btnChooseColor.szName = L( "Choose logo color" );
	btnChooseColor.SetRect( x, logo.pos.y + logo.size.h + UI_OUTLINE_WIDTH, width, 32 );
	btnChooseColor.onReleased = VoidCb( &CMenuPlayerSetup::ShowColorPicker );
	colorPickerDlg.Link( this );
	colorPickerDlg.onOk = VoidCb( &CMenuPlayerSetup::OnColorPickerOk );
	UpdateLogo();
}

/*
=================
UI_PlayerSetup_Init
=================
*/
void CMenuPlayerSetup::_Init( void )
{
	int addFlags = 0;

	hideModels = hideLogos = false;

	// disable playermodel preview for HLRally to prevent crash
	if( !stricmp( gMenu.m_gameinfo.gamefolder, "hlrally" ))
		hideModels = true;

	if( gMenu.m_gameinfo.flags & GFL_NOMODELS )
		addFlags |= QMF_INACTIVE;

	banner.SetPicture(ART_BANNER);

	name.szName = L( "GameUI_PlayerName" );
	name.iMaxLength = 32;
	name.LinkCvar( "name" );
	name.SetRect( 360, 270, 300, 36 );

	view.iFlags |= addFlags;
	view.SetRect( 700, 270, 260, 300 );

	modelsModel.Update();
	if( !modelsModel.GetRows( ))
	{
		model.SetVisibility( false );
		hideModels = true;
	}
	else
	{
		model.Setup( &modelsModel );
		model.LinkCvar( "model", CMenuEditable::CVAR_STRING );
		model.onChanged = VoidCb( &CMenuPlayerSetup::UpdateModel );
		model.SetRect( 700, 570 + UI_OUTLINE_WIDTH, 260, 32 );
	}

	topColor.iFlags |= addFlags;
	topColor.szName = L( "Colors" );
	topColor.Setup( 0, 255, 1 );
	topColor.LinkCvar( "topcolor" );
	topColor.onCvarChange = CMenuEditable::WriteCvarCb;
	topColor.onChanged = VoidCb( &CMenuPlayerSetup::ApplyColorToImagePreview );
	topColor.SetCoord( 700, 660 );
	topColor.size.w = 260;

	bottomColor.iFlags |= addFlags;
	bottomColor.Setup( 0, 255, 1 );
	bottomColor.LinkCvar( "bottomcolor" );
	bottomColor.onCvarChange = CMenuEditable::WriteCvarCb;
	bottomColor.onChanged = VoidCb( &CMenuPlayerSetup::ApplyColorToImagePreview );;
	bottomColor.SetCoord( 700, 700 );
	bottomColor.size.w = 260;

	msgBox.SetMessage( L( "Please, choose another player name" ) );
	msgBox.Link( this );

	AddItem( banner );

	AddButton( L( "Done" ), nullptr, PC_DONE, VoidCb( &CMenuPlayerSetup::SaveAndPopMenu ) );
	CMenuPicButton *gameOpt = AddButton( L( "Game options" ), nullptr, PC_GAME_OPTIONS );
	SET_EVENT_MULTI( gameOpt->onReleased,
	{
		((CMenuPlayerSetup*)pSelf->Parent())->SetConfig();
		UI_AdvUserOptions_Menu();
	});

	AddButton( L( "Adv. Options" ), nullptr, PC_ADV_OPT, UI_GameOptions_Menu );
	gameOpt->SetGrayed( !UI_AdvUserOptions_IsAvailable() );
	
	AddButton( L( "Crosshair" ), nullptr, PC_CROSSHAIR, UI_Crosshair_Menu );

	showModels.iFlags |= addFlags;
	showModels.szName = L( "Show 3D preview" );
	showModels.onCvarChange = CMenuEditable::WriteCvarCb;
	showModels.LinkCvar( "ui_showmodels" );
	showModels.SetCoord( 77, 230 + m_iBtnsNum * 50 + 5 );

	hiModels.iFlags |= addFlags;
	hiModels.szName = L( "GameUI_HighModels" );
	hiModels.onCvarChange = CMenuEditable::WriteCvarCb;
	hiModels.LinkCvar( "cl_himodels" );
	hiModels.SetCoord( 77, showModels.pos.y + 45 );

	voiceEnable.szName = L( "GameUI_EnableVoice" );
	voiceEnable.onCvarChange = CMenuEditable::WriteCvarCb;
	voiceEnable.LinkCvar( "voice_modenable" ); // unlike engine's voice_enable, this is synchronized with server
	voiceEnable.SetCoord( 77, hiModels.pos.y + 45 );

	transmitVolume.szName = L( "GameUI_VoiceTransmitVolume" );
	transmitVolume.onCvarChange = CMenuEditable::WriteCvarCb;
	transmitVolume.Setup( 0, 1, 0.05f );
	transmitVolume.LinkCvar( "voice_transmit_scale" );
	transmitVolume.SetCoord( 77, voiceEnable.pos.y + 75 );
	transmitVolume.size.w = 300;

	receiveVolume.szName = L( "GameUI_VoiceReceiveVolume" );
	receiveVolume.onCvarChange = CMenuEditable::WriteCvarCb;
	receiveVolume.Setup( 0, 1, 0.05f );
	receiveVolume.LinkCvar( "voice_scale" );
	receiveVolume.SetCoord( 77, transmitVolume.pos.y + 50 );
	receiveVolume.size.w = 300;

	noProprietaryCodecNotice.szName = L( "* Uses Opus Codec.\nOpen, royalty-free, highly versatile audio codec." );
	noProprietaryCodecNotice.colorBase = uiColorHelp;
	noProprietaryCodecNotice.SetCharSize( QM_SMALLFONT );
	noProprietaryCodecNotice.SetRect( 77, receiveVolume.pos.y + 20, 400, 100 );

	InitLogoControls( 460, 370, 200, 200 );

	AddItem( name );
	AddItem( voiceEnable );
	AddItem( transmitVolume );
	AddItem( receiveVolume );
	AddItem( noProprietaryCodecNotice );

	if( !hideLogos )
	{
		AddItem( logo );
		AddItem( btnChooseColor );
		AddItem( logoImage );
	}

	if( !(gMenu.m_gameinfo.flags & GFL_NOMODELS) )
	{
		AddItem( topColor );
		AddItem( bottomColor );
		AddItem( showModels );
		AddItem( hiModels );
		AddItem( model );
		// disable playermodel preview for HLRally to prevent crash
		if( !hideModels )
		{
			AddItem( view );
		}
	}
}

void CMenuPlayerSetup::Reload()
{
	if( !hideLogos )
	{
		ParseLogoColorCvar();
		m_horizontal = EngFuncs::GetCvarFloat( "ui_logohorizontal" ) != 0.f;
		UpdateLogo();
	}
	if( !hideModels ) UpdateModel();
}


ADD_MENU( menu_playersetup, CMenuPlayerSetup, UI_PlayerSetup_Menu );

#ifdef __EMSCRIPTEN__
class CMenuPlayerSettings : public CMenuPlayerSetup
{
public:
	CMenuPlayerSettings() : CMenuPlayerSetup( "CMenuPlayerSettings" ) {}

private:
	void _Init() override;
	void Reload() override;
	void SaveAndPopMenu() override;
	void UpdateCrosshairMode();
	void OpenMoreOptions();

	CMenuClassicCrosshair crosshair{ true };
	CMenuCheckBox enhanced;
	CMenuAction crosshairLabel, sprayLabel, enhancedHint, sprayHint;
	CMenuAction save, cancel, more;
};

void CMenuPlayerSettings::_Init()
{
	hideModels = true;
	UseSettingsPanel( L( "Player settings" ), L( "Set up your crosshair and spraypaint." ) );
	const auto addLabel = [this]( CMenuAction &label, const char *text, int x, int y, int width, EFontSizes fontSize )
	{
		label.SetNameAndStatus( L( text ), nullptr );
		label.SetCharSize( fontSize );
		label.SetRect( x, y, width, 40 );
		label.SetInactive( true );
		label.colorBase = PackRGBA( 216, 222, 211, 255 );
		AddItem( label );
	};
	const auto addButton = [this]( CMenuAction &button, const char *text, int x, int width, CEventCallback callback )
	{
		button.SetNameAndStatus( L( text ), nullptr );
		button.SetRect( x, 555, width, 42 );
		button.SetCharSize( QM_SMALLFONT );
		button.SetTextInsetX( 12 );
		button.eTextAlignment = QM_LEFT;
		button.eFocusAnimation = QM_HIGHLIGHTIFFOCUS;
		button.SetBackground( PackRGBA( 62, 70, 55, 255 ), PackRGBA( 85, 98, 74, 255 ) );
		button.colorBase = PackRGBA( 216, 222, 211, 255 );
		button.colorFocus = uiColorWhite;
		button.onReleased = callback;
		AddItem( button );
	};

	addLabel( crosshairLabel, "Crosshair", 106, 214, 385, QM_DEFAULTFONT );
	addLabel( sprayLabel, "Spraypaint", 550, 214, 375, QM_DEFAULTFONT );

	enhanced.szName = L( "Use enhanced crosshair" );
	enhanced.LinkCvar( "xhair_enable" );
	enhanced.SetCoord( 108, 260 );
	enhanced.SetCharSize( QM_SMALLFONT );
	enhanced.iFlags &= ~QMF_DROPSHADOW;
	enhanced.onChanged = VoidCb( &CMenuPlayerSettings::UpdateCrosshairMode );
	AddItem( enhanced );
	crosshair.SetRect( 108, 316, 405, 220 );
	AddItem( crosshair );
	addLabel( enhancedHint, "Edit the enhanced crosshair in More player options.", 108, 297, 400, QM_SMALLERFONT );

	InitLogoControls( 771, 316, 134, 134 );
	if( !hideLogos )
	{
		logo.szName = L( "Spray image" );
		logo.SetCharSize( QM_SMALLFONT );
		logo.iFlags &= ~QMF_DROPSHADOW;
		logo.SetRect( 550, 316, 200, 36 );
		logoImage.szName = L( "Preview" );
		logoImage.SetCharSize( QM_SMALLFONT );
		logoImage.SetInactive( true );
		btnChooseColor.SetRect( 550, 373, 200, 36 );
		btnChooseColor.szName = L( "Spray color" );
		btnChooseColor.UseSettingsStyle();
		AddItem( logo );
		AddItem( btnChooseColor );
		AddItem( logoImage );
		addLabel( sprayHint, "Set the Spray Logo key in Controls.", 550, 469, 360, QM_SMALLERFONT );
	}
	else
	{
		addLabel( sprayHint, "No spray images are available.", 550, 287, 360, QM_SMALLERFONT );
	}

	msgBox.SetMessage( L( "Couldn't save the spray image. Choose another image and try again." ) );
	msgBox.Link( this );
	addButton( more, "More player options", 106, 246, VoidCb( &CMenuPlayerSettings::OpenMoreOptions ) );
	addButton( cancel, "GameUI_Cancel", 672, 104, VoidCb( &CMenuPlayerSettings::Hide ) );
	addButton( save, "GameUI_Save", 786, 132, VoidCb( &CMenuPlayerSettings::SaveAndPopMenu ) );
}

void CMenuPlayerSettings::Reload()
{
	CMenuFramework::Reload();
	CMenuPlayerSetup::Reload();
	UpdateCrosshairMode();
}

void CMenuPlayerSettings::UpdateCrosshairMode()
{
	crosshair.SetVisibility( !enhanced.bChecked );
	enhancedHint.SetVisibility( enhanced.bChecked );
}

void CMenuPlayerSettings::SaveAndPopMenu()
{
	if( !WriteNewLogo() )
	{
		msgBox.Show();
		return;
	}
	enhanced.WriteCvar();
	if( !enhanced.bChecked )
		crosshair.Save();
	CMenuFramework::SaveAndPopMenu();
}

void CMenuPlayerSettings::OpenMoreOptions()
{
	Hide();
	UI_PlayerSetup_Menu();
}

ADD_MENU( menu_playersettings, CMenuPlayerSettings, UI_PlayerSettings_Menu );
#endif
