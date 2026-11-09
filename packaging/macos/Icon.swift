import Cocoa
let target = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath:target,withIntermediateDirectories:true)
for size in [16,32,64,128,256,512,1024] {
    let image = NSImage(size:NSSize(width:size,height:size))
    image.lockFocus()
    let scale = CGFloat(size)/1024
    let transform = NSAffineTransform()
    transform.scale(by:scale)
    transform.concat()
    NSColor(calibratedWhite:0.025,alpha:1).setFill()
    NSBezierPath(roundedRect:NSRect(x:32,y:32,width:960,height:960),xRadius:210,yRadius:210).fill()
    let mark = NSAffineTransform()
    mark.translateX(by:129.97,yBy:696)
    mark.scaleX(by:11.5,yBy:-11.5)
    mark.concat()
    NSColor(calibratedWhite:1.0,alpha:1).setFill()
    NSBezierPath(rect:NSRect(x:22.154,y:4.923,width:22.154,height:7.385)).fill()
    NSBezierPath(rect:NSRect(x:22.154,y:19.692,width:22.154,height:7.385)).fill()
    for points in [
        [(9.514,16.0),(18.46,4.923),(12.715,0.283),(0.021,16.0),(12.717,31.717),(18.461,27.077)],
        [(56.947,16.0),(48.0,4.923),(53.745,0.283),(66.44,16.0),(53.744,31.717),(48.0,27.077)]
    ] {
        let path = NSBezierPath()
        path.move(to:NSPoint(x:points[0].0,y:points[0].1))
        for point in points.dropFirst() { path.line(to:NSPoint(x:point.0,y:point.1)) }
        path.close(); path.fill()
    }
    image.unlockFocus()
    let rep = NSBitmapImageRep(data:image.tiffRepresentation!)!
    let png = rep.representation(using:.png,properties:[:])!
    try png.write(to:URL(fileURLWithPath:target).appendingPathComponent("size_\(size).png"))
}
