FROM emscripten/emsdk:4.0.23 AS wasm-engine
WORKDIR /src
ENV XASH_BUILD_COMMIT_DATE="2026-08-12 13:40:39 +0500" \
    EMCC_CFLAGS="-s USE_SDL=2"
COPY game/engine/ ./
RUN CFLAGS=-fPIC CXXFLAGS=-fPIC CC=emcc CXX=em++ ./waf configure --emscripten -T release \
    && emmake ./waf build \
    && mkdir -p /out \
    && cp build/engine/xash /out/xash.js \
    && cp build/engine/xash.wasm /out/xash.wasm \
    && cp build/filesystem/filesystem_stdio.so /out/filesystem_stdio.so \
    && cp build/ref/gl/libref_gles3compat.so /out/libref_gles3compat.so

FROM emscripten/emsdk:4.0.23 AS wasm-cs16
WORKDIR /src
COPY game/cs16-client/ ./
COPY game/engine/3rdparty/extras/xash-extras/gfx/fonts/ ./3rdparty/cs16client-extras/gfx/fonts/
COPY licenses/valve-hl1-sdk/LICENSE ./3rdparty/cs16client-extras/licenses/valve-hl1-sdk/LICENSE
RUN emcmake cmake -S . -B build \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/out \
      -DBUILD_SERVER=OFF \
      -DBUILD_BOTS=OFF \
      -DMAINUI_USE_STB=ON \
    && cmake --build build --parallel 4 \
    && cmake --install build

FROM scratch AS runtime-export
COPY --from=wasm-engine /out/xash.js /out/xash.wasm /
COPY --from=wasm-engine /out/filesystem_stdio.so /out/libref_gles3compat.so /
COPY --from=wasm-cs16 /out/cstrike/cl_dlls/client_emscripten_wasm32.wasm /
COPY --from=wasm-cs16 /out/cstrike/cl_dlls/menu_emscripten_wasm32.wasm /
COPY --from=wasm-cs16 /out/cstrike/extras.pk3 /
