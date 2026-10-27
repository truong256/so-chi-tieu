"""
ai_training/scripts/train_lora.py
=================================
Supervised Fine-Tuning (SFT) Script with PEFT / LoRA for So Chi Tieu AI Chatbot.

Configurable for:
- Base models: Qwen/Qwen2.5-0.5B-Instruct, Qwen/Qwen2.5-1.5B-Instruct, Qwen/Qwen3.5-4B
- Hardware check: Verifies VRAM and device availability before allocating
- Safety: Clean error handling preventing system freezes
"""

import os
import sys
import json
import argparse
import time
from typing import Dict, Any

def get_vram_gb() -> float:
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory / (1024**3)
    except Exception:
        pass
    return 0.0

def train(base_model_name: str, output_dir: str, epochs: int = 2, batch_size: int = 1):
    print("=" * 60)
    print("SO CHI TIEU — AI COPILOT LORA FINE-TUNING PIPELINE")
    print("=" * 60)
    
    start_time = time.time()
    vram_gb = get_vram_gb()
    print(f"Detected GPU: {vram_gb:.2f} GB VRAM")
    print(f"Target Base Model: {base_model_name}")
    print(f"Target Epochs: {epochs}, Batch Size: {batch_size}")

    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer
    from peft import LoraConfig, get_peft_model, TaskType

    dataset_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dataset")
    train_file = os.path.join(dataset_dir, "train.jsonl")
    val_file = os.path.join(dataset_dir, "val.jsonl")

    if not os.path.exists(train_file) or not os.path.exists(val_file):
        print(f"Error: Dataset not found in {dataset_dir}. Run generate_dataset.py first.")
        sys.exit(1)

    # 1. Feasibility & VRAM check
    # 4B models in FP16 require 8GB VRAM (exceeds 6GB RTX 2060).
    # 1.5B requires ~3GB VRAM, 0.5B requires ~1.2GB VRAM.
    is_large_model = "4b" in base_model_name.lower() or "7b" in base_model_name.lower()
    if is_large_model and vram_gb < 8.0:
        print("\n" + "!" * 60)
        print("HARDWARE LIMITATION DETECTED:")
        print(f"Model '{base_model_name}' requires minimum 8.0 - 12.0 GB VRAM.")
        print(f"Current GPU only has {vram_gb:.2f} GB VRAM.")
        print("Status: BLOCKED — Hardware insufficient for native unquantized fine-tuning of 4B+ model.")
        print("To protect the machine from system-level CUDA OOM, fine-tuning is halted.")
        print("Recommended alternatives:")
        print("1. Use smaller base model: Qwen/Qwen2.5-0.5B-Instruct or Qwen/Qwen2.5-1.5B-Instruct")
        print("2. Use RAG architecture with installed Qwen2.5-coder:7b in Ollama (Already integrated & validated)")
        print("!" * 60 + "\n")
        return {
            "status": "BLOCKED",
            "reason": f"Insufficient VRAM: {vram_gb:.2f} GB available < 8.0 GB required",
            "model": base_model_name
        }

    # 2. Tokenizer & Model loading
    print(f"\nLoading Tokenizer for {base_model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(base_model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print(f"Loading Base Model {base_model_name} in FP16...")
    try:
        model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map="auto" if torch.cuda.is_available() else None,
            trust_remote_code=True
        )
    except Exception as e:
        print(f"Model loading failed: {e}")
        return {"status": "FAILED", "error": str(e)}

    # 3. LoRA Configuration
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # 4. Load dataset
    print(f"Loading training samples from {train_file}...")
    train_texts = []
    with open(train_file, "r", encoding="utf-8") as f:
        for line in f:
            data = json.loads(line)
            # Format according to chat template
            conv = data["messages"]
            prompt = tokenizer.apply_chat_template(conv, tokenize=False)
            train_texts.append(prompt)

    print(f"Loaded {len(train_texts)} training examples.")
    encodings = tokenizer(
        train_texts,
        truncation=True,
        max_length=512,
        padding=True,
        return_tensors="pt"
    )

    class CustomDataset(torch.utils.data.Dataset):
        def __init__(self, encodings):
            self.encodings = encodings
        def __getitem__(self, idx):
            item = {k: v[idx] for k, v in self.encodings.items()}
            item["labels"] = item["input_ids"].clone()
            return item
        def __len__(self):
            return len(self.encodings["input_ids"])

    train_dataset = CustomDataset(encodings)

    # 5. Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        fp16=torch.cuda.is_available(),
        logging_steps=5,
        save_strategy="epoch",
        report_to="none"
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset
    )

    print("\nStarting Training...")
    train_result = trainer.train()
    
    # Save adapter
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    elapsed = time.time() - start_time
    print(f"\n✔ Training completed successfully in {elapsed:.2f}s!")
    print(f"Adapter checkpoints saved to: {output_dir}")

    return {
        "status": "COMPLETED",
        "train_loss": train_result.training_loss,
        "elapsed_seconds": elapsed,
        "output_dir": output_dir
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_model", type=str, default="Qwen/Qwen2.5-0.5B-Instruct")
    parser.add_argument("--output_dir", type=str, default="models_checkpoints/sochitieu_financial_copilot_lora")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch_size", type=int, default=1)
    args = parser.parse_args()

    res = train(args.base_model, args.output_dir, args.epochs, args.batch_size)
    print("Final Result:", json.dumps(res, indent=2))
