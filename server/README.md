# lapis-llm (server)

The Python package behind LapisLLM: the **master** (registry, placement, admin API,
OpenAI-compatible `/v1` router) and the **node agent**.

```bash
pip install -e ".[dev]"
lapis demo                 # master + five simulated nodes on this machine
lapis master               # control plane on :8080
lapis agent --master http://<master>:8080 --name gaming-pc
lapis estimate --params 8 --quant q4 --memory 8
pytest                     # test-suite
```

See the [project README](../README.md) for the full picture.
