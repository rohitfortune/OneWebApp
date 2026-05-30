import sys
import os
from rembg import remove
from PIL import Image

input_path = "/Users/rohit/.gemini/antigravity/brain/093acdf9-acc1-4753-96b1-fc9d0201cfeb/media__1780141105772.jpg"
output_path = "src/assets/logo.png"

try:
    input_image = Image.open(input_path)
    # Using alpha matting for perfect edges
    output_image = remove(input_image, alpha_matting=True, alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10, alpha_matting_erode_size=10)
    output_image.save(output_path)
    print("Background removed successfully.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
