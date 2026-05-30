from PIL import Image
import sys

image_path = "src/assets/logo.png"

try:
    img = Image.open(image_path)
    # getbbox() finds the bounding box of the non-zero alpha regions
    bbox = img.getbbox()
    if bbox:
        # Crop image to the exact bounding box
        cropped = img.crop(bbox)
        
        # We might want to make it square for favicons so it doesn't get distorted
        # The bounding box might be rectangular (tall pencil)
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        
        # Create a new square image with a transparent background
        size = max(width, height)
        # Add a tiny bit of padding (e.g. 5%)
        pad = int(size * 0.05)
        new_size = size + pad * 2
        
        square_img = Image.new('RGBA', (new_size, new_size), (0, 0, 0, 0))
        
        # Paste the cropped image in the center
        paste_x = pad + (size - width) // 2
        paste_y = pad + (size - height) // 2
        
        square_img.paste(cropped, (paste_x, paste_y))
        
        square_img.save(image_path)
        square_img.save("public/favicon.png")
        print("Image cropped and squared successfully.")
    else:
        print("Empty bounding box.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
