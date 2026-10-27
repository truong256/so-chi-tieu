import sys
import torch

print("PyTorch version:", torch.__version__, flush=True)
print("CUDA available:", torch.cuda.is_available(), flush=True)
if torch.cuda.is_available():
    print("Device name:", torch.cuda.get_device_name(0), flush=True)
    total_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    print(f"VRAM total (GB): {total_gb:.2f}", flush=True)
else:
    print("CUDA is NOT available in this PyTorch build.", flush=True)
