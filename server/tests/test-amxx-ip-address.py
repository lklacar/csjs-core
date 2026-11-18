#!/usr/bin/env python3
"""Compile the patched AMXX IP natives with fortification; pass the pinned source directory."""
from pathlib import Path
import subprocess
import sys
import tempfile


def check_ip_addresses(source):
    native_source = (source / "amxmodx/amxmodx.cpp").read_text()
    native = native_source[native_source.index("static cell AMX_NATIVE_CALL get_user_ip("):
                           native_source.index("static cell AMX_NATIVE_CALL get_user_attacker(")]
    geoip_source = (source / "modules/geoip/geoip_util.cpp").read_text()
    strip_port = geoip_source[geoip_source.index("char *stripPort("):
                             geoip_source.index("const char* stristr(")]
    harness = r'''
    #include <algorithm>
    #include <cassert>
    #include <cstring>
    #include <amtl/am-string.h>
    #include "csjs_ip_address.h"

    using cell = int;
    #define AMX_NATIVE_CALL
    struct AMX { char output[128]; };
    struct GlobalVariables { int maxClients; } globals = {32}, *gpGlobals = &globals;
    struct Player { ke::AString ip; } g_players[33];
    const char *server_address;
    #define CVAR_GET_STRING(name) server_address
    cell set_amxstring(AMX *amx, cell, const char *value, cell maximum) {
        auto length = std::min(strlen(value), static_cast<size_t>(maximum));
        memcpy(amx->output, value, length);
        amx->output[length] = '\0';
        return length;
    }
    ''' + native + strip_port + r'''
    int main() {
        const char *addresses[][2] = {
            {"8.8.8.8:27015", "8.8.8.8"},
            {"8.8.8.8", "8.8.8.8"},
            {"[2001:4860:4860:abcd:1234:5678:9abc:def0]:65535", "2001:4860:4860:abcd:1234:5678:9abc:def0"},
            {"2001:4860:4860:abcd:1234:5678:9abc:def0", "2001:4860:4860:abcd:1234:5678:9abc:def0"},
            {"[::ffff:8.8.8.8]:27015", "::ffff:8.8.8.8"},
            {"::1", "::1"}, {"[::1]", "::1"},
            {"loopback", "loopback"}, {"", ""}, {"[invalid", "[invalid"},
        };
        AMX amx = {};
        cell parameters[] = {4 * sizeof(cell), 1, 0, 127, 0};
        for (const auto &address : addresses) {
            g_players[1].ip = address[0];
            server_address = address[0];
            for (auto player_index : {0, 1, 33}) {
                parameters[1] = player_index;
                for (auto without_port : {0, 1}) {
                    parameters[4] = without_port;
                    auto expected = address[without_port];
                    assert(get_user_ip(&amx, parameters) == strlen(expected));
                    assert(strcmp(amx.output, expected) == 0);
                }
            }
            char geoip_address[64];
            ke::SafeStrcpy(geoip_address, sizeof(geoip_address), address[0]);
            assert(strcmp(stripPort(geoip_address), address[1]) == 0);
        }
        parameters[1] = 1;
        parameters[3] = 3;
        g_players[1].ip = "[2001:4860:4860:abcd:1234:5678:9abc:def0]:65535";
        assert(get_user_ip(&amx, parameters) == 3);
        assert(strcmp(amx.output, "200") == 0);
        parameters[3] = 127;
        parameters[4] = 0;
        g_players[1].ip = "invalid-address-that-is-longer-than-the-native-buffer-capacity-and-must-not-overflow";
        assert(get_user_ip(&amx, parameters) == CSJS_IP_ADDRESS_SIZE - 1);
    }
    '''
    with tempfile.TemporaryDirectory() as directory:
        harness_path = Path(directory) / "ip-address.cpp"
        executable = Path(directory) / "ip-address-check"
        harness_path.write_text(harness)
        subprocess.run(["c++", "-m32", "-std=c++11", "-O2", "-D_FORTIFY_SOURCE=2",
                        "-fstack-protector-all", "-I" + str(source / "public"),
                        "-I" + str(source / "public/amtl"), str(harness_path), "-o", str(executable)], check=True)
        subprocess.run([str(executable)], check=True)
    print("AMXX IPv4/IPv6 native and GeoIP address checks passed")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: test-amxx-ip-address.py AMXX_SOURCE_DIRECTORY")
    check_ip_addresses(Path(sys.argv[1]))
