import Cocoa
// Finder background, drawn at its logical window size.
let image = NSImage(size: NSSize(width: 700, height: 440))
image.lockFocus()
NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
NSRect(x: 0, y: 0, width: 700, height: 440).fill()
func text(_ value: String, _ y: CGFloat, _ size: CGFloat, _ color: NSColor, _ bold: Bool = false) {
    let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
    (value as NSString).draw(in: NSRect(x: 24, y: y, width: 652, height: 35), withAttributes: [
        .font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size),
        .foregroundColor: color, .paragraphStyle: paragraph])
}
let ink = NSColor(calibratedWhite: 0.12, alpha: 1)
let muted = NSColor(calibratedWhite: 0.40, alpha: 1)
text("Minimal Data Studio", 357, 28, ink, true)
text("Drag the app into Applications to install.", 318, 15, muted)
NSColor(calibratedWhite: 0.65, alpha: 1).setStroke()
let arrow = NSBezierPath(); arrow.lineWidth = 3; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 309, y: 212)); arrow.line(to: NSPoint(x: 391, y: 212))
arrow.move(to: NSPoint(x: 379, y: 224)); arrow.line(to: NSPoint(x: 391, y: 212)); arrow.line(to: NSPoint(x: 379, y: 200)); arrow.stroke()
text("Then open Minimal Data Studio from Applications.", 72, 14, ink)
text("Your project files stay where they are.", 43, 12, muted)
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
