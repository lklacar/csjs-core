ARG AMXMODX_VERSION=1.9.0-git5302-xash-git2

FROM debian:bookworm-slim AS build-base
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake g++-multilib git libwebsockets-dev:i386 ninja-build pkg-config python3 \
    && rm -rf /var/lib/apt/lists/*
FROM build-base AS native-engine
WORKDIR /src/engine
COPY game/engine/ ./
ENV XASH_BUILD_COMMIT_DATE="2026-08-12 13:40:39 +0500"
RUN PKG_CONFIG_LIBDIR=/usr/lib/i386-linux-gnu/pkgconfig:/usr/share/pkgconfig \
      ./waf configure -T release -4 --dedicated --enable-websocket \
    && printf '%s\n' '#include "common.h"' '#include "server.h"' \
      '_Static_assert(offsetof(sv_client_t, edict) == 0x64b40, "Update the AMXX edict offset patch");' \
      | cc -m32 -x c -fsyntax-only -DENGINE_DLL=1 -DXASH_DEDICATED=1 \
        -Iengine/common -Iengine/server -Iengine/client -Iengine \
        -Icommon -Ipublic -Ipm_shared -Ifilesystem -I3rdparty/library_suffix/include - \
    && ./waf build \
    && mkdir /out \
    && cp build/engine/xash build/filesystem/filesystem_stdio.so /out/
FROM build-base AS native-cs16
WORKDIR /src/cs16
COPY game/cs16-client/ ./
RUN cmake -S . -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/out \
      -DCMAKE_C_FLAGS=-m32 -DCMAKE_CXX_FLAGS=-m32 -DCMAKE_SHARED_LINKER_FLAGS=-m32 \
      -DBUILD_CLIENT=OFF -DBUILD_MAINUI=OFF -DBUILD_SERVER=ON -DBUILD_BOTS=OFF \
    && cmake --build build --parallel 4 \
    && cmake --install build \
    && cp /out/cstrike/dlls/cs*.so /out/cs_server.so

FROM build-base AS native-amxx
ARG AMXMODX_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends nasm python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/alliedmodders/ambuild.git \
    && git -C ambuild checkout 5b0aa725beef33c9cf6a1b00659a010c3d9120d3 \
    && python3 -m venv /opt/ambuild \
    && /opt/ambuild/bin/pip install ./ambuild \
    && git clone https://github.com/alliedmodders/metamod-hl1.git metamod \
    && git -C metamod checkout 18a10db686702e8ae9e0fcb5b5febf8881dc9c2d \
    && git clone https://github.com/alliedmodders/hlsdk.git \
    && git -C hlsdk checkout a0edb7792a96998d349325bebab8ea41ec5cb239 \
    && git clone --branch "v${AMXMODX_VERSION}" --recurse-submodules https://github.com/ludufre/amxmodx.git \
    && test "$(git -C amxmodx rev-parse HEAD)" = 165f205f42f87320d2a0f8137ef92b9d82b192d3
COPY server/amxx-xash.patch /build/amxx-xash.patch
COPY server/tests/test-amxx-ip-address.py /build/test-amxx-ip-address.py
RUN git -C amxmodx apply /build/amxx-xash.patch \
    && python3 /build/test-amxx-ip-address.py /src/amxmodx \
    && sed -i '/^builder.RunBuildScripts(/,$d' amxmodx/AMBuildScript \
    && printf '%s\n' "builder.RunBuildScripts(['amxmodx/AMBuilder', 'modules/geoip/AMBuilder'], {'AMXX': AMXX})" >> amxmodx/AMBuildScript \
    && mkdir amxmodx/build
WORKDIR /src/amxmodx/build
RUN /opt/ambuild/bin/python ../configure.py --enable-optimize --no-mysql --metamod=/src/metamod --hlsdk=/src/hlsdk \
    && /opt/ambuild/bin/ambuild --jobs 4

FROM debian:trixie-slim AS native-addons
RUN dpkg --add-architecture i386 \
    && apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libc6:i386 libstdc++6:i386 patchelf python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /downloads
ARG METAMOD_VERSION=1.21p37-xash3d-git2
ARG AMXMODX_VERSION
RUN curl -fsSL "https://github.com/ludufre/metamod-p/releases/download/v${METAMOD_VERSION}/metamod-${METAMOD_VERSION}-linux.tar.gz" -o metamod.tar.gz \
    && curl -fsSL "https://github.com/ludufre/amxmodx/releases/download/v${AMXMODX_VERSION}/amxmodx-${AMXMODX_VERSION}-base-linux-gcc.tar.gz" -o base.tar.gz \
    && curl -fsSL "https://github.com/ludufre/amxmodx/releases/download/v${AMXMODX_VERSION}/amxmodx-${AMXMODX_VERSION}-cstrike-linux-gcc.tar.gz" -o cstrike.tar.gz \
    && printf '%s\n' \
      'a9cb141395b61d16996a90137ae4945054460cf3cc5ed272aff4f44e87a75259  metamod.tar.gz' \
      '75109e227a14434574e1d3aa5faab62bf8ead51ae02823208fde46d6e3434037  base.tar.gz' \
      '9c0005134498249eea7d3627fa161a0c0c47c80a2ecdb7c45be99d152c85c76c  cstrike.tar.gz' | sha256sum -c - \
    && mkdir /out \
    && tar -xzf metamod.tar.gz -C /out \
    && tar -xzf base.tar.gz -C /out \
    && tar -xzf cstrike.tar.gz -C /out \
    && printf '%s\n' 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so' > /out/addons/metamod/plugins.ini \
    && printf '%s\n' 'gamedll /csjs/cs_server.so' > /out/addons/metamod/config.ini
COPY --from=native-amxx /src/amxmodx/build/amxmodx/amxmodx_mm_i386/amxmodx_mm_i386.so /out/addons/amxmodx/dlls/amxmodx_mm_i386.so
COPY --from=native-amxx /src/amxmodx/build/modules/geoip/geoip_amxx_i386/geoip_amxx_i386.so /out/addons/amxmodx/modules/geoip_amxx_i386.so
RUN find /out/addons -type f -name '*.so' -exec patchelf --clear-execstack {} +

FROM debian:bookworm-slim
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6:i386 libwebsockets17:i386 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --home-dir /csjs csjs
WORKDIR /csjs
COPY --from=native-engine --chown=csjs:csjs /out/xash /out/filesystem_stdio.so ./
COPY --from=native-cs16 --chown=csjs:csjs /out/cs_server.so ./
COPY --from=native-addons --chown=csjs:csjs /out/addons/ ./cstrike/addons/
COPY licenses/valve-hl1-sdk/LICENSE /usr/share/licenses/valve-hl1-sdk/LICENSE
COPY --chown=csjs:csjs server/defaults/ ./
RUN chown csjs:csjs /csjs
ENV HOME=/csjs LD_LIBRARY_PATH=/csjs
USER csjs
EXPOSE 27015/udp 27016/tcp
ENTRYPOINT ["/csjs/xash", "-game", "cstrike", "-rodir", "/data", "-dll", "/csjs/cstrike/addons/metamod/dlls/metamod.so", "-console"]
CMD ["+hostname", "CSJS", "+maxplayers", "16", "+map", "de_dust2"]
