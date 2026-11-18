// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

#include "CheckBox.h"
#include "ItemsHolder.h"
#include "SpinControl.h"

class CMenuClassicCrosshair : public CMenuItemsHolder
{
public:
	explicit CMenuClassicCrosshair( bool compact = false ) : compact( compact ) {}
	void Save();

private:
	void _Init() override;
	void Reload() override;

	bool compact;
	CMenuSpinControl size;
	CMenuSpinControl color;
	CMenuCheckBox translucent;
	CMenuCheckBox dynamic;

	class CMenuCrosshairPreview : public CMenuBaseItem
	{
	public:
		void Draw() override;

		HIMAGE hImage;
		HIMAGE hWhite;
	} preview;
};
