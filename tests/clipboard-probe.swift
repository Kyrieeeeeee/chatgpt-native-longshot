import AppKit
import Foundation

// Run only immediately after the extension's successful PNG write in the
// isolated headed test browser. This verifies the actual macOS pasteboard.
let board = NSPasteboard.general
let destination = URL(fileURLWithPath: CommandLine.arguments[1])
if let png = board.data(forType: .png) {
    try png.write(to: destination)
    print("macOS pasteboard: public.png")
} else if let tiff = board.data(forType: .tiff),
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) {
    try png.write(to: destination)
    print("macOS pasteboard: public.tiff (decoded for pixel verification)")
} else {
    fputs("No image on macOS system pasteboard\n", stderr)
    exit(1)
}
