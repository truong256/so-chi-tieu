"""
ai_service/benchmark.py
=======================
Performance benchmarking script for FastAPI AI Service:
- Startup time (lifespan model load)
- RAM usage (RSS and VMS)
- Latency statistics (Mean, P50, P95, P99, Max) over 100 requests per endpoint
- Export results to ai_service/benchmark_results.json
"""

import os
import sys
import json
import time
from pathlib import Path
import psutil
import numpy as np
from fastapi.testclient import TestClient

# Ensure workspace root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai_service.app import app
from ai_service.loaders.model_loader import ModelContainer


def run_benchmark():
    print("================================================================================")
    print("               FASTAPI AI SERVICE — PERFORMANCE BENCHMARK                      ")
    print("================================================================================")

    # 1. Startup Time Measurement
    t0_start = time.perf_counter()
    container = ModelContainer.get_instance()
    container.load_all_models()
    startup_time_ms = round((time.perf_counter() - t0_start) * 1000.0, 2)
    print(f"Startup Time (Model Loading): {startup_time_ms:.2f} ms")

    # 2. RAM Usage Measurement
    process = psutil.Process(os.getpid())
    mem_info = process.memory_info()
    ram_rss_mb = round(mem_info.rss / (1024 * 1024), 2)
    ram_vms_mb = round(mem_info.vms / (1024 * 1024), 2)
    print(f"RAM Usage (Resident RSS):    {ram_rss_mb:.2f} MB")
    print(f"RAM Usage (Virtual VMS):     {ram_vms_mb:.2f} MB")

    # 3. Endpoint Latency Benchmarking (100 runs per endpoint)
    sample_advisor_payload = {
        "financial_summary": {
            "income": 25000000.0,
            "expense": 18500000.0,
            "previous_month_expense": 17000000.0,
            "wallets": [{"name": "Techcombank", "balance": 35000000.0}],
            "savings_goals": [{"name": "Quỹ khẩn cấp", "target": 60000000.0, "current": 30000000.0, "monthly_target": 3000000.0}],
            "categories": [
                {"name": "Ăn uống gia đình", "kind": "expense", "budget": 5000000.0, "amount": 5200000.0},
                {"name": "Ăn ngoài & Cafe", "kind": "expense", "budget": 2000000.0, "amount": 2600000.0},
            ]
        },
        "classification": None,
        "forecast": {"available": False, "reason": "model_not_approved"},
        "risk": None,
    }

    endpoints = [
        ("GET /health", "get", "/health", None),
        ("POST /advisor", "post", "/advisor", sample_advisor_payload),
        ("POST /classify", "post", "/classify", {"text": "GrabFood lunch"}),
        ("POST /forecast", "post", "/forecast", {"days": 30}),
        ("POST /risk", "post", "/risk", {"amount": 1500000.0, "credit_limit": 20000000.0}),
    ]

    benchmark_stats = {}
    N_ITERATIONS = 100

    with TestClient(app) as client:
        # Warmup
        client.get("/health")
        client.post("/advisor", json=sample_advisor_payload)

        print("\n--- Latency Benchmark (100 requests per endpoint) ---")
        print(f"{'Endpoint':<18} | {'Mean':>8} | {'P50':>8} | {'P95':>8} | {'P99':>8} | {'Max':>8} | Status")
        print("-" * 75)

        for name, method, url, payload in endpoints:
            latencies = []
            for _ in range(N_ITERATIONS):
                t0 = time.perf_counter()
                if method == "get":
                    res = client.get(url)
                else:
                    res = client.post(url, json=payload)
                dt = (time.perf_counter() - t0) * 1000.0
                assert res.status_code == 200
                latencies.append(dt)

            mean_l = round(float(np.mean(latencies)), 2)
            p50_l = round(float(np.percentile(latencies, 50)), 2)
            p95_l = round(float(np.percentile(latencies, 95)), 2)
            p99_l = round(float(np.percentile(latencies, 99)), 2)
            max_l = round(float(np.max(latencies)), 2)

            benchmark_stats[name] = {
                "mean_ms": mean_l,
                "p50_ms": p50_l,
                "p95_ms": p95_l,
                "p99_ms": p99_l,
                "max_ms": max_l,
                "sla_target_ms": 100.0,
                "sla_met": p95_l < 100.0,
            }

            status_str = "PASS (<100ms)" if p95_l < 100.0 else "FAIL"
            print(f"{name:<18} | {mean_l:>5.2f} ms | {p50_l:>5.2f} ms | {p95_l:>5.2f} ms | {p99_l:>5.2f} ms | {max_l:>5.2f} ms | {status_str}")

    results = {
        "startup_time_ms": startup_time_ms,
        "ram_usage_mb": {
            "rss_mb": ram_rss_mb,
            "vms_mb": ram_vms_mb,
        },
        "endpoint_latencies": benchmark_stats,
        "all_sla_met": all(v["sla_met"] for v in benchmark_stats.values()),
    }

    out_file = Path(__file__).resolve().parent / "benchmark_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("-" * 75)
    print(f"✔ Benchmark results saved to: {out_file}")
    print("================================================================================")


if __name__ == "__main__":
    run_benchmark()
