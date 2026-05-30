from PIL import Image
import sys

source_path = "src/assets/logo.png"
output_path = "/Users/rohit/.gemini/antigravity/brain/093acdf9-acc1-4753-96b1-fc9d0201cfeb/google-consent-logo.png"

try:
    img = Image.open(source_path).convert("RGBA")
    
    # Create a white background 120x120
    bg = Image.new("RGBA", (120, 120), "white")
    
    # Resize the logo to fit nicely with a small margin (100x100)
    img_resized = img.resize((100, 100), Image.Resampling.LANCZOS)
    
    # Paste the logo into the center
    bg.alpha_composite(img_resized, (10, 10))
    
    # Save as PNG
    bg.save(output_path, format="PNG")
    print("Consent logo generated successfully.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
