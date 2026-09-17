# Preprocessing scripts

Unless noted otherwise, all commands in this document are run from the
`scripts` directory. The local `.venv` and Python caches are ignored by the
Python-specific `scripts/.gitignore`.

## Export the CQT ONNX model

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python export_cqt_onnx.py
```

The exporter writes `../src/assets/cqt_preprocess.onnx`. The model accepts
`audio` with shape `[1, samples, 1]` and returns `cqt` with shape
`[frames, 288]`.

## Compare CQT JS and ONNX

```sh
deno run --unstable-sloppy-imports --allow-read --allow-env --allow-net \
  compare_cqt_deno.mjs
```

Optional arguments are the sample count and relative-error tolerance:

```sh
deno run --unstable-sloppy-imports --allow-read --allow-env --allow-net \
  compare_cqt_deno.mjs 220500 1e-4
```

## Export the beat ONNX model

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python export_beat_onnx.py
```

The exporter writes `../src/assets/beat_preprocess.onnx`. The model accepts
`audio` with shape `[1, samples, 1]` and returns `features` with shape
`[frames, 314]`.

## Compare beat JS and ONNX

```sh
deno run --unstable-sloppy-imports --allow-read --allow-env --allow-net \
  compare_beat_deno.mjs
```

Optional arguments are the sample count and relative-error tolerance:

```sh
deno run --unstable-sloppy-imports --allow-read --allow-env --allow-net \
  compare_beat_deno.mjs 441000 1e-4
```
