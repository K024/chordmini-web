#!/usr/bin/env python3

import argparse
import math
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "src/assets/beat_preprocess.onnx"

SR = 44_100
FPS = 100
HOP_SIZE = round(SR / FPS)
FRAME_SIZES = (1024, 2048, 4096)
NUM_BANDS = (3, 6, 12)
FMIN = 30.0
FMAX = 17_000.0
FREF = 440.0
DIFF_RATIO = 0.5
EXPECTED_FEATURES = 314


def hann_window(length: int) -> np.ndarray:
    index = np.arange(length, dtype=np.float64)
    return 0.5 - 0.5 * np.cos((2.0 * np.pi * index) / (length - 1))


def log_frequencies(
    bands_per_octave: int,
    fmin: float = FMIN,
    fmax: float = FMAX,
    fref: float = FREF,
) -> np.ndarray:
    left = math.floor(math.log2(fmin / fref) * bands_per_octave)
    right = math.ceil(math.log2(fmax / fref) * bands_per_octave)
    frequencies = fref * np.power(
        2.0,
        np.arange(left, right, dtype=np.float64) / bands_per_octave,
    )
    frequencies = frequencies[np.searchsorted(frequencies, fmin) :]
    return frequencies[: np.searchsorted(frequencies, fmax, "right")]


def frequencies_to_bins(
    frequencies: np.ndarray,
    bin_frequencies: np.ndarray,
) -> np.ndarray:
    indices = np.searchsorted(bin_frequencies, frequencies)
    indices = np.clip(indices, 1, len(bin_frequencies) - 1)
    left = bin_frequencies[indices - 1]
    right = bin_frequencies[indices]
    indices -= frequencies - left < right - frequencies
    return np.unique(indices)


def make_filterbank(
    frame_size: int,
    bands_per_octave: int,
) -> tuple[np.ndarray, int]:
    bin_frequencies = np.fft.fftfreq(frame_size, 1.0 / SR)[: frame_size // 2]
    frequencies = log_frequencies(bands_per_octave)
    bins = frequencies_to_bins(frequencies, bin_frequencies)
    if len(bins) < 3:
        raise ValueError("Expected at least three filterbank bins")

    filters: list[np.ndarray] = []
    starts: list[int] = []
    for index in range(len(bins) - 2):
        start = int(bins[index])
        center = int(bins[index + 1])
        stop = int(bins[index + 2])
        if stop - start < 2:
            center = start
            stop = start + 1
        length = stop - start
        if length <= 0:
            continue
        data = np.zeros(length, dtype=np.float64)
        rising = center - start
        falling = stop - center
        if rising > 0:
            data[:rising] = np.linspace(0.0, 1.0, rising, endpoint=False)
        if falling > 0:
            data[rising:] = np.linspace(1.0, 0.0, falling, endpoint=False)
        total = float(data.sum())
        if total > 0:
            data /= total
        filters.append(data)
        starts.append(start)

    filterbank = np.zeros((len(bin_frequencies), len(filters)), dtype=np.float32)
    for band, (start, data) in enumerate(zip(starts, filters, strict=True)):
        stop = start + len(data)
        if start < 0:
            data = data[-start:]
            start = 0
            stop = start + len(data)
        if stop > filterbank.shape[0]:
            data = data[: filterbank.shape[0] - start]
            stop = start + len(data)
        filterbank[start:stop, band] = np.maximum(
            filterbank[start:stop, band],
            data.astype(np.float32),
        )
    return filterbank, len(filters)


def diff_frames(frame_size: int) -> int:
    window = hann_window(frame_size)
    sample = int(np.argmax(window > DIFF_RATIO * float(window.max())))
    samples = frame_size / 2.0 - sample
    return int(max(1, math.floor(samples / HOP_SIZE + 0.5)))


def scalar_initializer(
    name: str,
    value: int | float,
    dtype: np.dtype,
) -> onnx.TensorProto:
    return numpy_helper.from_array(np.array(value, dtype=dtype), name)


def add_slice(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    prefix: str,
    input_name: str,
    output_name: str,
    starts: list[int],
    ends: list[int] | str,
    axes: list[int],
) -> None:
    starts_name = f"{prefix}_starts"
    ends_name = f"{prefix}_ends"
    axes_name = f"{prefix}_axes"
    initializers.extend(
        [
            numpy_helper.from_array(np.array(starts, dtype=np.int64), starts_name),
            numpy_helper.from_array(np.array(axes, dtype=np.int64), axes_name),
        ]
    )
    if isinstance(ends, str):
        ends_name = ends
    else:
        initializers.append(
            numpy_helper.from_array(np.array(ends, dtype=np.int64), ends_name)
        )
    nodes.append(
        helper.make_node(
            "Slice",
            [input_name, starts_name, ends_name, axes_name],
            [output_name],
        )
    )


def add_stft_magnitude(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    signal_name: str,
    frames_name: str,
    prefix: str,
    frame_size: int,
) -> str:
    half = frame_size // 2
    pads_name = f"{prefix}_pads"
    zeros_name = f"{prefix}_pad_value"
    hop_name = f"{prefix}_hop"
    window_name = f"{prefix}_window"
    padded_name = f"{prefix}_padded"
    spectrum_name = f"{prefix}_spectrum"
    real_slice_name = f"{prefix}_real_slice"
    imag_slice_name = f"{prefix}_imag_slice"
    real_squeezed_name = f"{prefix}_real_squeezed"
    imag_squeezed_name = f"{prefix}_imag_squeezed"
    real_frequency_name = f"{prefix}_real_frequency"
    imag_frequency_name = f"{prefix}_imag_frequency"
    real_frames_name = f"{prefix}_real_frames"
    imag_frames_name = f"{prefix}_imag_frames"
    real_name = f"{prefix}_real"
    imag_name = f"{prefix}_imag"

    initializers.extend(
        [
            numpy_helper.from_array(
                np.array([0, half, 0, 0, half, 0], dtype=np.int64),
                pads_name,
            ),
            scalar_initializer(zeros_name, 0, np.float32),
            scalar_initializer(hop_name, HOP_SIZE, np.int64),
            numpy_helper.from_array(
                hann_window(frame_size).astype(np.float32),
                window_name,
            ),
            numpy_helper.from_array(np.array([3], dtype=np.int64), f"{prefix}_complex_axis"),
            numpy_helper.from_array(np.array([0], dtype=np.int64), f"{prefix}_batch_axis"),
        ]
    )
    nodes.extend(
        [
            helper.make_node(
                "Pad",
                [signal_name, pads_name, zeros_name],
                [padded_name],
                mode="constant",
            ),
            helper.make_node(
                "STFT",
                [padded_name, hop_name, window_name],
                [spectrum_name],
                onesided=1,
            ),
        ]
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_real",
        spectrum_name,
        real_slice_name,
        [0],
        [1],
        [3],
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_imag",
        spectrum_name,
        imag_slice_name,
        [1],
        [2],
        [3],
    )
    nodes.extend(
        [
            helper.make_node(
                "Squeeze",
                [real_slice_name, f"{prefix}_complex_axis"],
                [real_squeezed_name],
            ),
            helper.make_node(
                "Squeeze",
                [imag_slice_name, f"{prefix}_complex_axis"],
                [imag_squeezed_name],
            ),
        ]
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_real_frequency",
        real_squeezed_name,
        real_frequency_name,
        [0],
        [frame_size // 2],
        [2],
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_imag_frequency",
        imag_squeezed_name,
        imag_frequency_name,
        [0],
        [frame_size // 2],
        [2],
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_real_frames",
        real_frequency_name,
        real_frames_name,
        [0],
        frames_name,
        [1],
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_imag_frames",
        imag_frequency_name,
        imag_frames_name,
        [0],
        frames_name,
        [1],
    )
    nodes.extend(
        [
            helper.make_node(
                "Squeeze",
                [real_frames_name, f"{prefix}_batch_axis"],
                [real_name],
            ),
            helper.make_node(
                "Squeeze",
                [imag_frames_name, f"{prefix}_batch_axis"],
                [imag_name],
            ),
        ]
    )
    return add_magnitude(nodes, prefix, real_name, imag_name)


def add_magnitude(
    nodes: list[onnx.NodeProto],
    prefix: str,
    real_name: str,
    imag_name: str,
) -> str:
    names = {
        "real_sq": f"{prefix}_real_sq",
        "imag_sq": f"{prefix}_imag_sq",
        "power": f"{prefix}_power",
        "magnitude": f"{prefix}_magnitude",
    }
    nodes.extend(
        [
            helper.make_node("Mul", [real_name, real_name], [names["real_sq"]]),
            helper.make_node("Mul", [imag_name, imag_name], [names["imag_sq"]]),
            helper.make_node("Add", [names["real_sq"], names["imag_sq"]], [names["power"]]),
            helper.make_node("Sqrt", [names["power"]], [names["magnitude"]]),
        ]
    )
    return names["magnitude"]


def add_log_filterbank(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    prefix: str,
    magnitude_name: str,
    filterbank_name: str,
) -> str:
    filtered_name = f"{prefix}_filtered"
    shifted_name = f"{prefix}_shifted"
    logged_name = f"{prefix}_logged"
    log10_name = f"{prefix}_log10"
    nodes.extend(
        [
            helper.make_node(
                "MatMul",
                [magnitude_name, filterbank_name],
                [filtered_name],
            ),
            helper.make_node(
                "Add",
                [filtered_name, f"{prefix}_one"],
                [shifted_name],
            ),
            helper.make_node("Log", [shifted_name], [logged_name]),
            helper.make_node(
                "Div",
                [logged_name, log10_name],
                [f"{prefix}_log"],
            ),
        ]
    )
    initializers.extend(
        [
            scalar_initializer(f"{prefix}_one", 1.0, np.float32),
            scalar_initializer(log10_name, math.log(10.0), np.float32),
        ]
    )
    return f"{prefix}_log"


def add_temporal_diff(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    prefix: str,
    log_name: str,
    diff_frames_value: int,
) -> str:
    tail_name = f"{prefix}_diff_tail"
    head_name = f"{prefix}_diff_head"
    difference_name = f"{prefix}_diff_raw"
    positive_name = f"{prefix}_diff_positive"
    padded_name = f"{prefix}_diff"
    pads_name = f"{prefix}_diff_pads"
    zero_name = f"{prefix}_diff_zero"
    initializers.extend(
        [
            numpy_helper.from_array(
                np.array(
                    [diff_frames_value, 0, 0, 0],
                    dtype=np.int64,
                ),
                pads_name,
            ),
            scalar_initializer(zero_name, 0.0, np.float32),
        ]
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_diff_tail",
        log_name,
        tail_name,
        [diff_frames_value, 0],
        [np.iinfo(np.int64).max, np.iinfo(np.int64).max],
        [0, 1],
    )
    add_slice(
        nodes,
        initializers,
        f"{prefix}_diff_head",
        log_name,
        head_name,
        [0, 0],
        [-diff_frames_value, np.iinfo(np.int64).max],
        [0, 1],
    )
    nodes.extend(
        [
            helper.make_node(
                "Sub",
                [tail_name, head_name],
                [difference_name],
            ),
            helper.make_node("Relu", [difference_name], [positive_name]),
            helper.make_node(
                "Pad",
                [positive_name, pads_name, zero_name],
                [padded_name],
                mode="constant",
            ),
        ]
    )
    return padded_name


def build_model() -> onnx.ModelProto:
    nodes: list[onnx.NodeProto] = []
    initializers: list[onnx.TensorProto] = []

    shape_name = "audio_shape"
    sample_count_index_name = "sample_count_index"
    sample_count_name = "sample_count"
    sample_count_float_name = "sample_count_float"
    hop_float_name = "hop_float"
    frame_count_float_name = "frame_count_float"
    frame_count_ceil_name = "frame_count_ceil"
    frames_name = "frames"

    initializers.extend(
        [
            numpy_helper.from_array(
                np.array([1], dtype=np.int64),
                sample_count_index_name,
            ),
            scalar_initializer(hop_float_name, float(HOP_SIZE), np.float32),
        ]
    )
    nodes.extend(
        [
            helper.make_node("Shape", ["audio"], [shape_name]),
            helper.make_node(
                "Gather",
                [shape_name, sample_count_index_name],
                [sample_count_name],
                axis=0,
            ),
            helper.make_node(
                "Cast",
                [sample_count_name],
                [sample_count_float_name],
                to=TensorProto.FLOAT,
            ),
            helper.make_node(
                "Div",
                [sample_count_float_name, hop_float_name],
                [frame_count_float_name],
            ),
            helper.make_node("Ceil", [frame_count_float_name], [frame_count_ceil_name]),
            helper.make_node(
                "Cast",
                [frame_count_ceil_name],
                [frames_name],
                to=TensorProto.INT64,
            ),
        ]
    )

    branch_outputs: list[str] = []
    expected_features = 0
    for index, (frame_size, bands) in enumerate(
        zip(FRAME_SIZES, NUM_BANDS, strict=True)
    ):
        prefix = f"branch_{index}"
        filterbank, actual_bands = make_filterbank(frame_size, bands)
        expected_features += actual_bands * 2
        filterbank_name = f"{prefix}_filterbank"
        initializers.append(
            numpy_helper.from_array(filterbank, filterbank_name)
        )
        magnitude_name = add_stft_magnitude(
            nodes,
            initializers,
            "audio",
            frames_name,
            prefix,
            frame_size,
        )
        log_name = add_log_filterbank(
            nodes,
            initializers,
            prefix,
            magnitude_name,
            filterbank_name,
        )
        diff_name = add_temporal_diff(
            nodes,
            initializers,
            prefix,
            log_name,
            diff_frames(frame_size),
        )
        branch_output = f"{prefix}_features"
        nodes.append(
            helper.make_node(
                "Concat",
                [log_name, diff_name],
                [branch_output],
                axis=1,
            )
        )
        branch_outputs.append(branch_output)

    if expected_features != EXPECTED_FEATURES:
        raise ValueError(
            f"Expected {EXPECTED_FEATURES} features, got {expected_features}"
        )

    nodes.append(
        helper.make_node(
            "Concat",
            branch_outputs,
            ["features"],
            axis=1,
        )
    )

    graph = helper.make_graph(
        nodes,
        "beat_preprocess",
        [
            helper.make_tensor_value_info(
                "audio",
                TensorProto.FLOAT,
                [1, "samples", 1],
            )
        ],
        [
            helper.make_tensor_value_info(
                "features",
                TensorProto.FLOAT,
                ["frames", EXPECTED_FEATURES],
            )
        ],
        initializers,
    )
    model = helper.make_model(
        graph,
        opset_imports=[helper.make_opsetid("", 17)],
        producer_name="chordmini-web",
        doc_string=(
            "Madmom-compatible multi-band downbeat preprocessing. "
            "Input is [1, samples, 1], output is [frames, 314]."
        ),
    )
    model.metadata_props.extend(
        [
            onnx.StringStringEntryProto(key="sample_rate", value=str(SR)),
            onnx.StringStringEntryProto(key="fps", value=str(FPS)),
            onnx.StringStringEntryProto(key="hop_size", value=str(HOP_SIZE)),
            onnx.StringStringEntryProto(key="features", value=str(EXPECTED_FEATURES)),
        ]
    )
    return model


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export madmom-compatible downbeat preprocessing to ONNX."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output model path (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    model = build_model()
    onnx.checker.check_model(model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, args.output)
    print(f"Exported {args.output} ({args.output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
