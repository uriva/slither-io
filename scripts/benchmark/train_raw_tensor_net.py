#!/usr/bin/env python3
import torch
import torch.nn as nn
import numpy as np
import json
import time

class RawSlitherNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(32, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 2)
        )

    def forward(self, x):
        return self.net(x)

def main():
    print("🚀 TRAINING NEURAL POLICY ON RAW SENSORY TENSORS")
    t0 = time.time()

    # Load 80,000 raw samples
    raw_data = np.fromfile('scripts/benchmark/raw_dataset.bin', dtype=np.float32)
    num_samples = len(raw_data) // 34
    data = raw_data.reshape(num_samples, 34)

    X = torch.tensor(data[:, :32], dtype=torch.float32)
    y = torch.tensor(data[:, 32:], dtype=torch.float32)

    print(f"Dataset: {X.shape[0]} transitions, input dim: {X.shape[1]}, output dim: {y.shape[1]}")

    # 80/20 train/val split
    n = len(X)
    idx = torch.randperm(n)
    train_idx = idx[:int(n * 0.8)]
    val_idx = idx[int(n * 0.8):]

    train_X, train_y = X[train_idx], y[train_idx]
    val_X, val_y = X[val_idx], y[val_idx]

    model = RawSlitherNet()
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    loss_fn = nn.MSELoss()

    batch_size = 256
    dataset = torch.utils.data.TensorDataset(train_X, train_y)
    loader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True)

    epochs = 20
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0
        for bx, by in loader:
            optimizer.zero_grad()
            pred = model(bx)
            loss = loss_fn(pred, by)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(bx)

        model.eval()
        with torch.no_grad():
            val_pred = model(val_X)
            val_loss = loss_fn(val_pred, val_y).item()
            # Steering MAE in degrees
            steer_mae_deg = torch.abs(val_pred[:, 0] - val_y[:, 0]).mean().item() * 180.0
            # Boost accuracy
            boost_acc = ((val_pred[:, 1] > 0.5) == (val_y[:, 1] > 0.5)).float().mean().item() * 100

        if epoch % 5 == 0 or epoch == epochs:
            print(f"  Epoch {epoch:2d}/{epochs} | Val MSE: {val_loss:.4f} | Steer Error: ±{steer_mae_deg:.1f}° | Boost Acc: {boost_acc:.1f}%")

    # Export weights to JSON for zero-dependency execution in TypeScript
    weights = {
        "w1": model.net[0].weight.detach().cpu().numpy().tolist(),
        "b1": model.net[0].bias.detach().cpu().numpy().tolist(),
        "w2": model.net[2].weight.detach().cpu().numpy().tolist(),
        "b2": model.net[2].bias.detach().cpu().numpy().tolist(),
        "w3": model.net[4].weight.detach().cpu().numpy().tolist(),
        "b3": model.net[4].bias.detach().cpu().numpy().tolist(),
    }

    with open('scripts/benchmark/trained_raw_net.json', 'w') as f:
        json.dump(weights, f)

    print(f"\n✅ Exported trained raw neural network weights to scripts/benchmark/trained_raw_net.json")
    print(f"⏱️  Training completed in {time.time() - t0:.2f}s!")

if __name__ == '__main__':
    main()
