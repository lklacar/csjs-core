#include "precompiled.h"
#include "cppunitlite/TestHarness.h"

// Undefined to class #define vec3_t Vector
#pragma push_macro("vec3_t")
#undef vec3_t

extern void AngleQuaternion(vec_t *angles, vec_t *quaternion);

TEST(AngleQuaternion, AnimationFuncs, 10000) {
	struct testdata_t {
		vec3_t angles;
		vec4_t quaternion;
	};

	testdata_t testdata[2] = {
			{ { 21.0f, 65.0f, 162.0f }, { -0.88286f, 0.13638f, -0.33691f, 0.29740f } },
			{ { 106.0f, 142.0f, 62.0f }, { 0.65693f, -0.21134f, -0.61609f, 0.37976f } }
	};

	for (int i = 0; i < ARRAYSIZE(testdata); i++) {
		vec3_t a = { testdata[i].angles[0] * 2.0f / float(M_PI), testdata[i].angles[1] * 2.0f / float(M_PI), testdata[i].angles[2] * 2.0f / float(M_PI), };
		vec4_t q;
		AngleQuaternion(a, q);

		DOUBLES_EQUAL("q[0] mismatch", testdata[i].quaternion[0], q[0], 0.00001);
		DOUBLES_EQUAL("q[1] mismatch", testdata[i].quaternion[1], q[1], 0.00001);
		DOUBLES_EQUAL("q[2] mismatch", testdata[i].quaternion[2], q[2], 0.00001);
		DOUBLES_EQUAL("q[3] mismatch", testdata[i].quaternion[2], q[2], 0.00001);
	}
}

#pragma pop_macro("vec3_t")

TEST(PlayerAnimationLongMapUptime, AnimationFuncs, 10000) {
	struct RestoreGlobals {
		globalvars_t *saved = gpGlobals;
		~RestoreGlobals() { gpGlobals = saved; }
	} restore;
	globalvars_t globals = {};
	gpGlobals = &globals;
	entvars_t vars = {};
	CBasePlayer player = {};
	player.pev = &vars;
	player.m_flFrameRate = 256.0f;
	player.m_fSequenceLoops = TRUE;
	vars.framerate = 1.0f;

	const double uptimes[] = { 1.0, 86400.0, 604800.0 };
	const float intervals[] = { 0.003f, 0.01f, 0.05f };
	for (double uptime : uptimes) {
		for (float interval : intervals) {
			vars.frame = 0.0f;
			vars.animtime = uptime;
			globals.time = uptime + interval;
			globals.frametime = interval;
			DOUBLES_EQUAL("player animation interval", interval, player.StudioFrameAdvance(), 0.000001);
			DOUBLES_EQUAL("player animation frame", interval * 256.0f, vars.frame, 0.0001);
		}
	}

	globals.frametime = 0.003f;
	DOUBLES_EQUAL("explicit animation interval", 0.02f, player.StudioFrameAdvance(0.02f), 0.000001);
	vars.animtime = 0.0f;
	vars.frame = 0.0f;
	DOUBLES_EQUAL("uninitialized animation", 0.0f, player.StudioFrameAdvance(), 0.000001);

	vars.animtime = globals.time;
	globals.frametime = 0.0f;
	DOUBLES_EQUAL("paused animation", 0.0f, player.StudioFrameAdvance(), 0.000001);

	vars.deadflag = DEAD_DYING;
	vars.animtime = 1.0f;
	globals.time = 1.02f;
	DOUBLES_EQUAL("death animation interval", 0.02f, player.StudioFrameAdvance(), 0.000001);
	DOUBLES_EQUAL("repeated death think", 0.0f, player.StudioFrameAdvance(), 0.000001);

	CBaseAnimating entity = {};
	entity.pev = &vars;
	entity.m_flFrameRate = 256.0f;
	entity.m_fSequenceLoops = TRUE;
	vars.animtime = 1.0f;
	globals.time = 1.02f;
	DOUBLES_EQUAL("non-player animation interval", 0.02f, entity.StudioFrameAdvance(), 0.000001);
}
