DIR=$(dirname "$BASH_SOURCE[0]")

export __WASM__=true
# export __API_PACS__=https://tasty.pacs.fishbirds.ru
# export __API_MARKUP__=https://markup.fishbirds.ru
export __CONFIG__=atrium

export DIR_RENDERITY=/Users/Denis/reps/renderity
export BIN_NODE=/Users/Denis/.nvm/versions/node/v14.4.0/bin/node
export DIR_WASI=/Users/Denis/lib/wasi-sdk-20.0
export DIR_WASI_SDK_LIBC=$DIR_WASI/share/wasi-sysroot/lib/wasm32-wasi-threads
export DIR_3DRENDERER=$DIR

cd $DIR
node node_modules/webpack-dev-server/bin/webpack-dev-server.js --env=development --mode=development --stats-children --open
