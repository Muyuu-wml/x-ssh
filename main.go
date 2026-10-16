package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "x-ssh",
		Width:     1440,
		Height:    900,
		MinWidth:  960,
		MinHeight: 600,
		Frameless: true, // An opaque HTML title bar keeps Windows 10 blur out of the caption.

		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		// CSS paints the selected theme; transparent WebView reveals the native backdrop.
		BackgroundColour: &options.RGBA{R: 23, G: 25, B: 29, A: 0},
		Windows: &windows.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			BackdropType:         windows.Acrylic,
		},

		OnStartup:  app.startup,
		OnShutdown: app.shutdown,

		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
