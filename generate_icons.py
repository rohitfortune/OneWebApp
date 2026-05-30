from PIL import Image
import sys

source_path = "public/favicon.png"

try:
    img = Image.open(source_path).convert("RGBA")
    
    # 1. PWA 192x192 (Transparent)
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save("public/pwa-192x192.png")
    
    # 2. PWA 512x512 (Transparent)
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save("public/pwa-512x512.png")
    
    # 3. Apple Touch Icon 180x180 (Needs solid background, iOS will turn transparent to black)
    # Let's create a white background or a gradient. A white background is safe and clean.
    img_180 = img.resize((180, 180), Image.Resampling.LANCZOS)
    
    # Create white background
    apple_icon = Image.new("RGBA", (180, 180), "white")
    
    # For the apple icon, we probably want some padding so the pencil isn't touching the edges
    # The current img_180 has 5% padding. Let's just paste it.
    # To paste with alpha composite:
    apple_icon.alpha_composite(img_180)
    
    # Save as RGB to drop alpha channel completely
    apple_icon.convert("RGB").save("public/apple-touch-icon.png")
    
    print("PWA icons generated successfully.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
