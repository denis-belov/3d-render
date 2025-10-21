# DIR=$(dirname "$BASH_SOURCE[0]")

# export __WASM__=true
# # export __API_PACS__=https://tasty.pacs.fishbirds.ru
# # export __API_MARKUP__=https://markup.fishbirds.ru
# export __CONFIG__=segm2

# export DIR_CC3D=~/rep/seung-lab/connected-components-3d/cc3d
# export DIR_RENDERITY=~/rep_work/renderity
# # export BIN_NODE=~/.nvm/versions/node/v14.4.0/bin/node
# export DIR_WASI=~/lib/wasi-sdk-20.0
# export DIR_WASI_SDK_LIBC=$DIR_WASI/share/wasi-sysroot/lib/wasm32-wasi-threads
# export DIR_3DRENDERER=$DIR



DIR=$(dirname "$BASH_SOURCE[0]")

export __WASM__=true
export __WEB__=true
export __CONFIG__=web2
export __API_PACS__=https://stage.pacs.fishbirds.ru

export DIR_CC3D=~/rep/seung-lab/connected-components-3d/cc3d
export DIR_RENDERITY=~/rep_work/renderity
# export BIN_NODE=/Users/Denis/.nvm/versions/node/v14.4.0/bin/node
export DIR_WASI=~/lib/wasi-sdk-20.0
export DIR_WASI_SDK_LIBC=$DIR_WASI/share/wasi-sysroot/lib/wasm32-wasi-threads
export DIR_3DRENDERER=$DIR



cd $DIR
~/.nvm/versions/node/v14.4.0/bin/node --max-old-space-size=8192 node_modules/webpack-dev-server/bin/webpack-dev-server.js --env=development --mode=development --stats-children --open
