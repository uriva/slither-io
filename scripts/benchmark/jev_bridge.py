#!/usr/bin/env python3
import sys
import os
import json
import time
import warnings
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import torch
import torch.nn as nn
from gliner2 import AutoExtractor
from gliner2.models.base import load_extractor_tokenizer

CLASSES = [
    'evade_hard_left',
    'evade_hard_right',
    'intercept_attack',
    'forage_food',
    'flee_to_center',
]

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

# Load encoder and tokenizer
model = AutoExtractor.from_pretrained('fastino/gliner2.5-small-v1', map_location='cpu')
tok = load_extractor_tokenizer('fastino/gliner2.5-small-v1')
encoder = model.encoder
encoder.eval()

# Load fine-tuned head
head = JevSlitherHead()
weights_path = os.path.join(os.path.dirname(__file__), 'jev_slither_head.pt')
if os.path.exists(weights_path):
    head.load_state_dict(torch.load(weights_path, weights_only=True))
head.eval()

# Ready signal
print(json.dumps({"status": "ready"}), flush=True)

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        text = req.get("text", "")

        t0 = time.time()
        inputs = tok([text], padding=True, truncation=True, max_length=64, return_tensors='pt')
        with torch.no_grad():
            out = encoder(**inputs)
            mask = inputs['attention_mask'].unsqueeze(-1).expand(out.last_hidden_state.size()).float()
            mean_pooled = torch.sum(out.last_hidden_state * mask, 1) / torch.clamp(mask.sum(1), min=1e-9)
            act_logits, boost_logits = head(mean_pooled)
            probs = torch.softmax(act_logits, dim=-1)[0]
            pred_idx = act_logits.argmax().item()
            action = CLASSES[pred_idx]
            confidence = probs[pred_idx].item()
            boost = boost_logits.argmax().item() == 1

        dt_ms = (time.time() - t0) * 1000

        print(json.dumps({
            "action": action,
            "boost": boost,
            "confidence": confidence,
            "dt_ms": dt_ms
        }), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
