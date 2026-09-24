#!/usr/bin/env python3
import torch
import torch.nn as nn
import numpy as np
import json
import time

NUM_BINS = 16
BIN_EDGES = np.linspace(-np.pi, np.pi, NUM_BINS + 1)
BIN_CENTERS = (BIN_EDGES[:-1] + BIN_EDGES[1:]) / 2.0

class DiscreteSlitherNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(40, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
        )
        self.angle_head = nn.Linear(64, NUM_BINS)
        self.boost_head = nn.Linear(64, 2)

    def forward(self, x):
        feat = self.shared(x)
        return self.angle_head(feat), self.boost_head(feat)

def main():
    print("🚀 TRAINING DISCRETE CLASSIFICATION POLICY (16 HEADING BINS)")
    t0 = time.time()

    raw_data = np.fromfile('scripts/benchmark/raw_dataset.bin', dtype=np.float32)
    num_samples = len(raw_data) // 42
    data = raw_data.reshape(num_samples, 42)

    X = torch.tensor(data[:, :40], dtype=torch.float32)
    # Target angle delta in [-pi, pi]
    target_angles = data[:, 40] * np.pi
    # Map to 16 discrete bins
    bin_indices = np.digitize(target_angles, BIN_EDGES) - 1
    bin_indices = np.clip(bin_indices, 0, NUM_BINS - 1)
    y_angle = torch.tensor(bin_indices, dtype=torch.long)

    # Boost target
    y_boost = torch.tensor(data[:, 41], dtype=torch.long)

    print(f"Dataset: {X.shape[0]} samples. Angle bins: {NUM_BINS}")

    n = len(X)
    idx = torch.randperm(n)
    train_idx = idx[:int(n * 0.8)]
    val_idx = idx[int(n * 0.8):]

    train_X, train_y_a, train_y_b = X[train_idx], y_angle[train_idx], y_boost[train_idx]
    val_X, val_y_a, val_y_b = X[val_idx], y_angle[val_idx], y_boost[val_idx]

    model = DiscreteSlitherNet()
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    batch_size = 256
    dataset = torch.utils.data.TensorDataset(train_X, train_y_a, train_y_b)
    loader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True)

    epochs = 15
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0
        for bx, by_a, by_b in loader:
            optimizer.zero_grad()
            pred_a, pred_b = model(bx)
            loss = criterion(pred_a, by_a) + 0.5 * criterion(pred_b, by_b)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(bx)

        model.eval()
        with torch.no_grad():
            v_a, v_b = model(val_X)
            acc_a = (v_a.argmax(dim=1) == val_y_a).float().mean().item() * 100
            acc_b = (v_b.argmax(dim=1) == val_y_b).float().mean().item() * 100

        if epoch % 5 == 0 or epoch == epochs:
            print(f"  Epoch {epoch:2d}/{epochs} | Loss: {total_loss/len(train_X):.3f} | Angle Acc: {acc_a:.1f}% | Boost Acc: {acc_b:.1f}%")

    # Export weights
    weights = {
        "bin_centers": BIN_CENTERS.tolist(),
        "w1": model.shared[0].weight.detach().cpu().numpy().tolist(),
        "b1": model.shared[0].bias.detach().cpu().numpy().tolist(),
        "w2": model.shared[2].weight.detach().cpu().numpy().tolist(),
        "b2": model.shared[2].bias.detach().cpu().numpy().tolist(),
        "w_angle": model.angle_head.weight.detach().cpu().numpy().tolist(),
        "b_angle": model.angle_head.bias.detach().cpu().numpy().tolist(),
        "w_boost": model.boost_head.weight.detach().cpu().numpy().tolist(),
        "b_boost": model.boost_head.bias.detach().cpu().numpy().tolist(),
    }

    with open('scripts/benchmark/discrete_net.json', 'w') as f:
        json.dump(weights, f)

    print(f"\n✅ Exported discrete classification net to scripts/benchmark/discrete_net.json in {time.time() - t0:.1f}s!")

if __name__ == '__main__':
    main()
