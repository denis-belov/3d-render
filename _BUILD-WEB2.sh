DIR=$(dirname "$BASH_SOURCE[0]")

export __WEB__=true
export __CONFIG__=web
export __API_PACS__=https://stage.pacs.fishbirds.ru

cd $DIR
node node_modules/webpack/bin/webpack.js --env=development --mode=development --stats-children
cp -R build/. /Users/denisbelov/rep_work/medray/dicom-viewer-v2/platform/app/segm-web2
cd /Users/denisbelov/rep_work/medray/dicom-viewer-v2/platform/app/segm-web2
git add . && git commit --allow-empty -m auto && git push origin main
