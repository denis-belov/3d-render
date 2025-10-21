DIR=$(dirname "$BASH_SOURCE[0]")

export __WASM__=true
export __CONFIG__=segm2

export DIR_RENDERITY=/Users/Denis/reps/renderity
# export BIN_NODE=/Users/Denis/.nvm/versions/node/v14.4.0/bin/node
export DIR_WASI=/Users/Denis/lib/wasi-sdk-20.0
export DIR_WASI_SDK_LIBC=$DIR_WASI/share/wasi-sysroot/lib/wasm32-wasi-threads
export DIR_3DRENDERER=$DIR

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. segm-4
cd segm-4
git add . && git commit --allow-empty -m auto && git push origin main
