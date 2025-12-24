const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const CleanTerminalPlugin = require('clean-terminal-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

// const vtk_rules = require('@kitware/vtk.js/Utilities/config/dependency.js').webpack.core.rules;

// vtk_rules[2].use =
// {
// 	loader: 'worker-loader',
// 	options: { inline: 'fallback' },
// };



module.exports = (env, argv) =>
{
	const DEV = env.development || argv.mode === 'development';
	const PROD = env.production || argv.mode === 'production';

	return {
		experiments:
		{
			asyncWebAssembly: true,
			// syncWebAssembly: true,
			// topLevelAwait: true,
		},

		entry: './src/index.js',

		target: 'web',

		// cache: false,

		resolve:
		{
			extensions: [ '.js', '.jsx', '.scss' ],

			fallback:
			{
				"fs": false,
				"path": false,
				"crypto": false,
				"stream": false,
				"util": false,
				"os": false,
				"buffer": false,
				"process": false,
				"assert": false,
			},
		},

		output:
		{
			path: path.join(__dirname, 'build'),
		},

		module:
		{
			rules:
			[
				{
					test: /\.worker\.js$/,
					include: /src/,

					use: 'worker-loader',
				},

				{
					test: /\.(js|jsx)$/,
					// exclude: /node_modules/,

					use:

						// env === 'development' ?

							[
								{
									loader: 'babel-loader',

									options:
									{
										presets:
										[
											'@babel/preset-env',
											'@babel/preset-react'
										],

										plugins:
										[
											'@babel/plugin-proposal-class-properties',
											'@babel/plugin-proposal-optional-chaining',
											'@babel/plugin-proposal-class-static-block',
											'@babel/plugin-syntax-import-meta'
										]
									},
								},
							]
				},

				{
					test: /\.(css|scss)$/,

					use:
					[
						MiniCssExtractPlugin.loader,
						'css-loader',
						'sass-loader',
					],
				},

				{
					test: /\.pug$/,

					use:
					[
						{
							loader: 'html-loader',

							options:
							{
								esModule: false
							}
						},

						{
							loader: 'pug-html-loader',

							options:
							{
								pretty: true,
								exports: false
							}
						}
					],
				},

				{
					test: /\.(png|jpg|jpeg)$/,
					use: 'base64-inline-loader',
				},

				{
					test: /\.svg$/,
					type: 'asset/resource',

					generator:
					{
						filename: 'images/[name].[hash][ext]',
					},
				},

				// for wasm files in node_modules
				{
					test: /\.wasm$/,
					type: 'asset/resource',
				},

				// ...vtk_rules,
			],
		},

		devtool: DEV ? 'eval-source-map' : false,

		optimization:
		(
			PROD ?

			{
				minimize: true,
				moduleIds: 'named',
				chunkIds: 'named',

				minimizer:
				[
					new TerserPlugin
					({
						test: /\.(js|jsx)$/,
						exclude: /node_modules/,

						terserOptions:
						{
							compress: {},
							mangle: true,
						},
					}),

					new CssMinimizerPlugin(),
				],
			} :

			{}
		),

		plugins:
		[
			new CleanWebpackPlugin(),

			new MiniCssExtractPlugin({ filename: 'index.css' }),

			new HtmlWebpackPlugin
			({
				filename: 'index.html',
				template: path.join(__dirname, 'src/index.pug'),
				inject: 'body',
				minify:
				(
					PROD ?

						{
							removeAttributeQuotes: true,
							removeComments: true,
							collapseWhitespace: true,
						} :

						false
				),
			}),

			// new CopyPlugin
			// ({
			// 	patterns:
			// 	[
			// 		{ from: '/', to: '/' },
			// 	],
			// }),

			new CleanTerminalPlugin({ beforeCompile: true }),

			new webpack.DefinePlugin
			({
				LOG: 'console.log',

				'process.env': JSON.stringify(process.env),
			}),
		],

		devServer:
		{
			compress: true,
			historyApiFallback: true,
			host: 'localhost',
			port: 3000,

			client:
			{
				overlay:
				{
					runtimeErrors: false,
				},
			},

			headers:
			{
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
			},
		},
	};
};
