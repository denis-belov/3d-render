# DIR=$(dirname "$BASH_SOURCE[0]")

# # export __API_PACS__=https://tasty.pacs.fishbirds.ru
# # export __API_MARKUP__=https://markup.fishbirds.ru
# export __CONFIG__=segm2

DIR=$(dirname "$BASH_SOURCE[0]")

if [ "$TOOL" ]; then
	TOOL=$TOOL
	TOOL_OPTIONS=$TOOL_OPTIONS
else
	TOOL=node_modules/webpack-dev-server/bin/webpack-dev-server
	TOOL_OPTIONS=--open
fi

export __WEB__=true
export __CONFIG__=web2
export __API_PACS__=https://stage.pacs.fishbirds.ru

cd $DIR
node --max-old-space-size=8192 $TOOL --env=development --mode=development --stats-children $TOOL_OPTIONS
