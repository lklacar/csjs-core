/*
Framework.cpp -- base menu fullscreen root window
Copyright (C) 2017 a1batross

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
*/
#include "Framework.h"
#include "PicButton.h"

// menu banners used fiexed rectangle (virtual screenspace at 640x480)
#define UI_BANNER_POSX		72
#define UI_BANNER_POSY		72
#define UI_BANNER_WIDTH		736
#define UI_BANNER_HEIGHT		128

CMenuFramework::CMenuFramework( const char *name ) : BaseClass( name )
{
	memset( m_apBtns, 0, sizeof( m_apBtns ) );
	m_iBtnsNum = 0;
	bannerAnimDirection = ANIM_NO;
}

CMenuFramework::~CMenuFramework()
{
	for( int i = 0; i < m_iBtnsNum; i++ )
	{
		RemoveItem( *( m_apBtns[i] ) );
		delete m_apBtns[i];
		m_apBtns[i] = NULL;
	}
}

void CMenuFramework::Show()
{
	BaseClass::Show();
}

void CMenuFramework::Draw()
{
	if( settingsTitle )
	{
		DrawSettingsPanel();
		BaseClass::Draw();
		return;
	}

	static int statusFadeTime;
	static CMenuBaseItem *lastItem;
	CMenuBaseItem *item;

	BaseClass::Draw();

	item = ItemAtCursor();
	// a1ba: maybe this should be somewhere else?
	if( item != lastItem )
	{
		if( item ) item->m_iLastFocusTime = uiStatic.realTime;
		statusFadeTime = uiStatic.realTime;

		lastItem = item;
	}

	// draw status text if status text isn't rendered at right side of an item
	// ideally, framework shouldn't even know about this but since everything
	// WON-styled goes here, let's leave it here...
	if( item && item == lastItem && !FBitSet( item->iFlags, QMF_NOTIFY ) && item->szStatusText != NULL )
	{
		float alpha = bound( 0, ((( uiStatic.realTime - statusFadeTime ) - 100 ) * 0.01f ), 1 );
		int r, g, b, x, len;

		EngFuncs::ConsoleStringLen( item->szStatusText, &len, NULL );

		UnpackRGB( r, g, b, uiColorHelp );
		EngFuncs::DrawSetTextColor( r, g, b, alpha * 255 );
		x = ( ScreenWidth - len ) * 0.5f; // centering

		EngFuncs::DrawConsoleString( x, uiStatic.yOffset + 720 * uiStatic.scaleY, item->szStatusText );
	}
	else statusFadeTime = uiStatic.realTime;
}

void CMenuFramework::UseSettingsPanel( const char *title, const char *subtitle )
{
	settingsTitle = title;
	settingsSubtitle = subtitle;
}

void CMenuFramework::DrawSettingsPanel()
{
	const Point frame = m_scPos + Point( 78, 112 ).Scale();
	const Size dimensions = Size( 868, 532 ).Scale();
	UI_FillRect( 0, 0, ScreenWidth, ScreenHeight, PackRGBA( 11, 16, 12, 128 ) );
	UI_FillRect( frame, dimensions, PackRGBA( 76, 88, 68, 255 ) );
	UI_DrawRectangleExt( frame, dimensions, PackRGBA( 136, 145, 128, 255 ), 1 );
	UI_FillRect( m_scPos + Point( 96, 204 ).Scale(), Size( 832, 338 ).Scale(), PackRGBA( 49, 57, 43, 255 ) );
	UI_DrawString( uiStatic.hBigFont, m_scPos + Point( 106, 126 ).Scale(), Size( 812, 46 ).Scale(),
		settingsTitle, PackRGBA( 236, 241, 231, 255 ), UI_BIG_CHAR_HEIGHT * uiStatic.scaleY, QM_LEFT, ETF_NO_WRAP );
	UI_DrawString( uiStatic.hSmallerFont, m_scPos + Point( 106, 172 ).Scale(), Size( 812, 23 ).Scale(),
		settingsSubtitle, PackRGBA( 204, 215, 197, 255 ), UI_SMALLER_CHAR_HEIGHT * uiStatic.scaleY, QM_LEFT, ETF_NO_WRAP );
}

void CMenuFramework::Hide()
{
	BaseClass::Hide();
}

void CMenuFramework::Init()
{
	BaseClass::Init();
	pos.x = uiStatic.xOffset;
	pos.y = uiStatic.yOffset;
	size.w = uiStatic.width;
	size.h = 768;
}

void CMenuFramework::VidInit()
{
	pos.x = settingsTitle ? ( ScreenWidth / uiStatic.scaleX - 1024 ) / 2 : uiStatic.xOffset;
	pos.y = uiStatic.yOffset;
	size.w = uiStatic.width;
	size.h = 768;
	BaseClass::VidInit();
}

CMenuPicButton * CMenuFramework::AddButton(const char *szName, const char *szStatus, EDefaultBtns buttonPicId, CEventCallback onReleased, int iFlags)
{
	if( m_iBtnsNum >= MAX_FRAMEWORK_PICBUTTONS )
	{
		Host_Error( "Too many pic buttons in framework!" );
		return NULL;
	}

	CMenuPicButton *btn = new CMenuPicButton();

	btn->SetNameAndStatus( szName, szStatus );
	btn->SetPicture( buttonPicId );
	btn->iFlags |= iFlags;
	if( settingsTitle )
		btn->UseSettingsStyle();
	btn->onReleased = onReleased;
	btn->SetCoord( 72, 230 + m_iBtnsNum * 50 );
	AddItem( btn );

	m_apBtns[m_iBtnsNum++] = btn;

	return btn;
}

CMenuPicButton * CMenuFramework::AddButton( const char *szName, const char *szStatus, const char *szButtonPath, CEventCallback onReleased, int iFlags, int hotkey )
{
	if( m_iBtnsNum >= MAX_FRAMEWORK_PICBUTTONS )
	{
		Host_Error( "Too many pic buttons in framework!" );
		return NULL;
	}

	CMenuPicButton *btn = new CMenuPicButton();

	btn->SetNameAndStatus( szName, szStatus );
	btn->SetPicture( szButtonPath, hotkey );
	btn->iFlags |= iFlags;
	if( settingsTitle )
		btn->UseSettingsStyle();
	btn->onReleased = onReleased;
	btn->SetCoord( 72, 230 + m_iBtnsNum * 50 );
	AddItem( btn );

	m_apBtns[m_iBtnsNum++] = btn;

	return btn;
}

void CMenuFramework::RealignButtons( void )
{
	for( int i = 0, j = 0; i < m_iBtnsNum; i++ )
	{
		if( !m_apBtns[i]->IsVisible())
			continue;

		m_apBtns[i]->SetCoord( 72, 230 + j * 50 );
		m_apBtns[i]->CalcPosition();
		j++;
	}
}

bool CMenuFramework::KeyDown( int key )
{
	bool b = BaseClass::KeyDown( key );

	if( UI::Key::IsEscape( key ))
	{
		const CMenuBaseWindow *newWindow = WindowStack()->Current();

		if( newWindow != nullptr && newWindow != this && newWindow->IsRoot() )
		{
			PrepareBannerAnimation( ANIM_CLOSING, nullptr );
		}
	}

	return b;
}

void CMenuFramework::PrepareBannerAnimation( EAnimation direction, CMenuPicButton *initiator )
{
	// banner is not present, ignore
	if( banner.Parent() != this )
		return;

	bannerAnimDirection = direction;
	if( initiator )
	{
		bannerRects[0].pt = initiator->GetRenderPosition();
		bannerRects[0].sz = initiator->GetRenderSize();

		bannerRects[1].pt = banner.GetRenderPosition();
		bannerRects[1].sz = banner.GetRenderSize();

		banner.szName = initiator->szName;
	}
}

bool CMenuFramework::DrawAnimation()
{
	bool b = CMenuBaseWindow::DrawAnimation( );

	if( bannerAnimDirection != ANIM_NO )
	{
		float frac;

		if( bannerAnimDirection == ANIM_OPENING )
			frac = ( uiStatic.realTime - m_iTransitionStartTime ) / TTT_PERIOD;
		else
			frac = 1.0f - ( uiStatic.realTime - m_iTransitionStartTime ) / TTT_PERIOD;
		Rect r = Rect::Lerp( bannerRects[0], bannerRects[1], frac );

		banner.Draw( r.pt, r.sz );
	}

	if( b )
		bannerAnimDirection = ANIM_NO;

	return b;
}

CMenuFramework::CMenuBannerBitmap::CMenuBannerBitmap()
{
	SetRect( UI_BANNER_POSX, UI_BANNER_POSY, UI_BANNER_WIDTH, UI_BANNER_HEIGHT );
}

void CMenuFramework::CMenuBannerBitmap::SetPicture(const char *pic)
{
	image.Load( pic );
}

void CMenuFramework::CMenuBannerBitmap::Draw( Point pt, Size sz )
{
	if( image.IsValid() )
	{
		UI_DrawPic( pt, sz, uiColorWhite, image, QM_DRAWADDITIVE );
	}
	else
	{
		UI_DrawString( uiStatic.hHeavyBlur, pt,
			sz,
			szName,
			uiPromptTextColor, m_scChSize,
			QM_LEFT, ETF_ADDITIVE | ETF_NOSIZELIMIT | ETF_FORCECOL );

		UI_DrawString( uiStatic.hLightBlur, pt,
			sz,
			szName,
			uiPromptTextColor, m_scChSize,
			QM_LEFT, ETF_ADDITIVE | ETF_NOSIZELIMIT | ETF_FORCECOL );
	}
}

void CMenuFramework::CMenuBannerBitmap::Draw()
{
	CMenuFramework *pParent = (CMenuFramework *)Parent();

	if (pParent && (pParent->bannerAnimDirection == ANIM_OPENING || pParent->eTransitionType == ANIM_OPENING))
		return;

	Draw( m_scPos, m_scSize );
}

