#!/usr/bin/env python3
import json
import time
import os
import warnings
warnings.filterwarnings('ignore')
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from gliner2 import AutoExtractor
from gliner2.models.base import load_extractor_tokenizer

CLASSES = [
    'evade_hard_left',
    'evade_hard_right',
    'intercept_attack',
    'forage_food',
    'flee_to_center',
]
CLASS_TO_IDX = {c: i for i, c in enumerate(CLASSES)}

class JevSlitherHead(nn.Module):
    def __init__(self, in_dim=384, num_classes=5):
        super().__init__()
        self.action_head = nn.Sequential(
            nn.Linear(in_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, num_classes)
        )
        self.boost_head = nn.Sequential(
            nn.Linear(in_dim, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, 2)
        )

    def forward(self, x):
        return self.action_head(x), self.boost_head(x)

def main():
    print("🚀 STARTING JEV ENCODER FINE-TUNING ON SLITHER DATASET")
    t0 = time.time()

    print("1. Loading dataset...")
    samples_per_class = 600
    class_counts = {c: 0 for c in CLASSES}
    dataset = []

    with open('scripts/benchmark/dataset.jsonl', 'r') as f:
        for line in f:
            if not line.strip():
                continue
            item = json.loads(line)
            act = item['action']
            if act in class_counts and class_counts[act] < samples_per_class:
                class_counts[act] += 1
                dataset.append(item)
            if all(v >= samples_per_class for v in class_counts.values()):
                break

    print(f"Loaded {len(dataset)} balanced samples ({samples_per_class} per class).")

    print("2. Loading fastino/gliner2.5-small-v1 encoder...")
    model = AutoExtractor.from_pretrained('fastino/gliner2.5-small-v1', map_location='cpu')
    tok = load_extractor_tokenizer('fastino/gliner2.5-small-v1')
    encoder = model.encoder
    encoder.eval()

    print("3. Encoding text through 74M DeBERTa encoder...")
    texts = [d['text'] for d in dataset]
    action_targets = torch.tensor([CLASS_TO_IDX[d['action']] for d in dataset], dtype=torch.long)
    boost_targets = torch.tensor([1 if d['boost'] == 'boost' else 0 for d in dataset], dtype=torch.long)

    batch_size = 64
    all_embeddings = []
    enc_start = time.time()

    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i+batch_size]
        inputs = tok(batch_texts, padding=True, truncation=True, max_length=64, return_tensors='pt')
        with torch.no_grad():
            out = encoder(**inputs)
            # Use mean pooling over token embeddings for rich contextual representations
            mask = inputs['attention_mask'].unsqueeze(-1).expand(out.last_hidden_state.size()).float()
            sum_embeddings = torch.sum(out.last_hidden_state * mask, 1)
            sum_mask = torch.clamp(mask.sum(1), min=1e-9)
            mean_pooled = sum_embeddings / sum_mask
            all_embeddings.append(mean_pooled)

        if (i // batch_size) % 10 == 0:
            print(f"  Encoded {min(i + batch_size, len(texts))}/{len(texts)} samples ({time.time() - enc_start:.1f}s)...")

    X = torch.cat(all_embeddings, dim=0)
    print(f"Features extracted! Matrix shape: {X.shape} in {time.time() - enc_start:.1f}s")

    # Train / Val Split (80 / 20)
    n = len(dataset)
    indices = torch.randperm(n)
    train_idx = indices[:int(n * 0.8)]
    val_idx = indices[int(n * 0.8):]

    train_loader = DataLoader(
        TensorDataset(X[train_idx], action_targets[train_idx], boost_targets[train_idx]),
        batch_size=32,
        shuffle=True
    )

    X_val, y_val_act, y_val_boost = X[val_idx], action_targets[val_idx], boost_targets[val_idx]

    print("4. Training classification heads with AdamW...")
    head = JevSlitherHead(in_dim=384, num_classes=len(CLASSES))
    optimizer = torch.optim.AdamW(head.parameters(), lr=1e-3, weight_decay=1e-2)
    criterion = nn.CrossEntropyLoss()

    epochs = 15
    for epoch in range(1, epochs + 1):
        head.train()
        total_loss = 0
        correct_act = 0
        total = 0

        for bx, by_act, by_boost in train_loader:
            optimizer.zero_grad()
            out_act, out_boost = head(bx)
            loss_act = criterion(out_act, by_act)
            loss_boost = criterion(out_boost, by_boost)
            loss = loss_act + 0.5 * loss_boost
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * bx.size(0)
            preds = out_act.argmax(dim=1)
            correct_act += (preds == by_act).sum().item()
            total += bx.size(0)

        # Validation
        head.eval()
        with torch.no_grad():
            v_act, v_boost = head(X_val)
            v_loss = criterion(v_act, y_val_act).item()
            v_preds = v_act.argmax(dim=1)
            v_acc = (v_preds == y_val_act).float().mean().item() * 100
            v_boost_acc = (v_boost.argmax(dim=1) == y_val_boost).float().mean().item() * 100

        if epoch % 3 == 0 or epoch == epochs:
            print(f"  Epoch {epoch:2d}/{epochs} | Train Loss: {total_loss/total:.3f} | Train Acc: {correct_act/total*100:.1f}% | Val Acc: {v_acc:.1f}% (Boost: {v_boost_acc:.1f}%)")

    # Save fine-tuned head weights
    save_path = 'scripts/benchmark/jev_slither_head.pt'
    torch.save(head.state_dict(), save_path)
    print(f"\n✅ Fine-tuned Jev Slither Head saved to {save_path}!")
    print(f"⏱️  Total Training Time: {(time.time() - t0):.1f}s")

if __name__ == '__main__':
    main()
