DIR=$(dirname "$BASH_SOURCE[0]")

export __WASM__=true
export __WEB__=true
export __CONFIG__=web
export __API_PACS__=https://stage.pacs.fishbirds.ru

export DIR_CC3D=~/rep/seung-lab/connected-components-3d/cc3d
export DIR_RENDERITY=/Users/Denis/reps/renderity
# export BIN_NODE=/Users/Denis/.nvm/versions/node/v14.4.0/bin/node
export DIR_WASI=/Users/Denis/lib/wasi-sdk-20.0
export DIR_WASI_SDK_LIBC=$DIR_WASI/share/wasi-sysroot/lib/wasm32-wasi-threads
export DIR_3DRENDERER=$DIR

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. /Users/denisbelov/rep_work/medray/dicom-viewer-v2/platform/app/segm-web2
cd /Users/denisbelov/rep_work/medray/dicom-viewer-v2/platform/app/segm-web2
git add . && git commit --allow-empty -m auto && git push origin main
