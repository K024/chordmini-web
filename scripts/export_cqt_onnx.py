#!/usr/bin/env python3

import argparse
import math
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "src/assets/cqt_preprocess.onnx"

SR = 22_050
HOP_LENGTH = 512
N_BINS = 288
BINS_PER_OCTAVE = 36
FMIN = 23.12465141947715  # noteToHz("F#0")
FILTER_SCALE = 1.0
NORM = 1.0
SPARSITY = 0.01
WINDOW = "hann"
SCALE = True


def hann_window(length: int) -> np.ndarray:
    index = np.arange(length, dtype=np.float64)
    return 0.5 - 0.5 * np.cos((2 * np.pi * index) / length)


def get_window(name: str, length: int) -> np.ndarray:
    if name == "ones":
        return np.ones(length, dtype=np.float64)
    if name == "hann":
        return hann_window(length)
    raise ValueError(f"Unsupported window {name}")


def float_window(name: str, length: float) -> np.ndarray:
    n_min = math.floor(length)
    n_max = math.ceil(length)
    window = get_window(name, n_min)
    if len(window) < n_max:
        padded = np.zeros(n_max, dtype=np.float64)
        padded[: len(window)] = window
        window = padded
    window[n_min:] = 0
    return window


def window_bandwidth(name: str, size: int = 1000) -> float:
    window = get_window(name, size)
    total = float(window.sum())
    squared = float(np.square(window).sum())
    return (size * squared) / (total * total + 1e-12)


def l1_normalize(real: np.ndarray, imag: np.ndarray) -> None:
    total = float(np.sum(np.hypot(real, imag)))
    if total == 0:
        return
    real /= total
    imag /= total


def next_power_of_two(value: float) -> int:
    return 1 << math.ceil(math.log2(max(1, value)))


def pad_center(data: np.ndarray, size: int) -> np.ndarray:
    out = np.zeros(size, dtype=np.float64)
    start = math.floor((size - len(data)) / 2)
    out[start : start + len(data)] = data
    return out


def cqt_frequencies(n_bins: int, fmin: float, bins_per_octave: int) -> np.ndarray:
    index = np.arange(n_bins, dtype=np.float64)
    return fmin * np.power(2, index / bins_per_octave)


def et_relative_bandwidth(bins_per_octave: int) -> np.ndarray:
    ratio = math.pow(2, 1 / bins_per_octave)
    return np.array([(ratio * ratio - 1) / (ratio * ratio + 1)], dtype=np.float64)


def relative_bandwidth(frequencies: np.ndarray) -> np.ndarray:
    log_frequencies = np.log2(frequencies)
    bandwidth = np.zeros(len(frequencies), dtype=np.float64)
    bandwidth[0] = 1 / (log_frequencies[1] - log_frequencies[0])
    bandwidth[-1] = 1 / (
        log_frequencies[-1] - log_frequencies[-2]
    )
    for index in range(1, len(bandwidth) - 1):
        bandwidth[index] = 2 / (
            log_frequencies[index + 1] - log_frequencies[index - 1]
        )
    return (np.power(2, 2 / bandwidth) - 1) / (
        np.power(2, 2 / bandwidth) + 1
    )


def wavelet_lengths(
    frequencies: np.ndarray,
    sample_rate: float,
    alpha: np.ndarray,
) -> tuple[np.ndarray, float]:
    gamma = np.zeros_like(alpha)
    quality = FILTER_SCALE / alpha
    bandwidth = window_bandwidth(WINDOW)
    cutoff = float(
        np.max(
            frequencies * (1 + 0.5 * bandwidth / quality)
            + 0.5 * gamma
        )
    )
    lengths = (quality * sample_rate) / (frequencies + gamma / alpha)
    return lengths, cutoff


def sparsify_rows(real: np.ndarray, imag: np.ndarray) -> None:
    for row in range(real.shape[0]):
        magnitudes = np.hypot(real[row], imag[row])
        total = float(magnitudes.sum())
        if total == 0:
            continue
        sorted_magnitudes = np.sort(magnitudes)
        cumulative = 0.0
        threshold = float(sorted_magnitudes[-1])
        for magnitude in sorted_magnitudes:
            cumulative += float(magnitude) / total
            if cumulative >= SPARSITY:
                threshold = float(magnitude)
                break
        mask = magnitudes < threshold
        real[row, mask] = 0
        imag[row, mask] = 0


def vqt_filter_fft(
    frequencies: np.ndarray,
    sample_rate: float,
    alpha: np.ndarray,
    hop_length: int | None = None,
) -> tuple[np.ndarray, np.ndarray, int]:
    lengths, _ = wavelet_lengths(frequencies, sample_rate, alpha)
    filters_real = []
    filters_imag = []

    for index, raw_length in enumerate(lengths):
        start = math.floor(-raw_length / 2)
        stop = math.floor(raw_length / 2)
        length = max(0, stop - start)
        real = np.zeros(length, dtype=np.float64)
        imag = np.zeros(length, dtype=np.float64)
        window = float_window(WINDOW, length)
        omega = (2 * math.pi * frequencies[index]) / sample_rate
        sample = np.arange(length, dtype=np.float64) + start
        real[:] = window * np.cos(omega * sample)
        imag[:] = window * np.sin(omega * sample)
        if NORM != 0:
            l1_normalize(real, imag)
        filters_real.append(real)
        filters_imag.append(imag)

    base_n_fft = next_power_of_two(math.ceil(float(np.max(lengths))))
    n_fft = base_n_fft
    if hop_length is not None:
        n_fft = max(n_fft, next_power_of_two(hop_length) * 2)
    n_freq = n_fft // 2 + 1
    basis_real = np.zeros((len(filters_real), n_freq), dtype=np.float64)
    basis_imag = np.zeros((len(filters_imag), n_freq), dtype=np.float64)

    for index, (real, imag) in enumerate(zip(filters_real, filters_imag, strict=True)):
        padded_real = pad_center(real, n_fft)
        padded_imag = pad_center(imag, n_fft)
        scale = lengths[index] / n_fft
        spectrum = np.fft.fft(padded_real * scale + 1j * padded_imag * scale)
        basis_real[index] = spectrum.real[:n_freq]
        basis_imag[index] = spectrum.imag[:n_freq]

    if SPARSITY > 0:
        sparsify_rows(basis_real, basis_imag)
    return basis_real, basis_imag, n_fft


def scalar_initializer(name: str, value: int | float, dtype) -> onnx.TensorProto:
    return numpy_helper.from_array(np.array(value, dtype=dtype), name)


def add_stft_branch(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    signal_name: str,
    branch_name: str,
    n_fft: int,
    hop_length: int,
    window_name: str,
) -> tuple[str, str, str]:
    pads_name = f"{branch_name}_pads"
    pad_value_name = f"{branch_name}_pad_value"
    frame_step_name = f"{branch_name}_frame_step"
    padded_name = f"{branch_name}_padded"
    spectrum_name = f"{branch_name}_spectrum"
    real_slice_name = f"{branch_name}_real_slice"
    imag_slice_name = f"{branch_name}_imag_slice"
    real_name = f"{branch_name}_real"
    imag_name = f"{branch_name}_imag"
    axes_name = f"{branch_name}_complex_axes"

    initializers.extend(
        [
            numpy_helper.from_array(
                np.array([0, n_fft // 2, 0, 0, n_fft // 2, 0], dtype=np.int64),
                pads_name,
            ),
            scalar_initializer(pad_value_name, 0, np.float32),
            scalar_initializer(frame_step_name, hop_length, np.int64),
            numpy_helper.from_array(np.array([0], dtype=np.int64), f"{branch_name}_start"),
            numpy_helper.from_array(np.array([1], dtype=np.int64), f"{branch_name}_end"),
            numpy_helper.from_array(np.array([2], dtype=np.int64), f"{branch_name}_complex_end"),
            numpy_helper.from_array(np.array([3], dtype=np.int64), axes_name),
        ]
    )
    nodes.extend(
        [
            helper.make_node(
                "Pad",
                [signal_name, pads_name, pad_value_name],
                [padded_name],
                mode="constant",
            ),
            helper.make_node(
                "STFT",
                [padded_name, frame_step_name, window_name],
                [spectrum_name],
                onesided=1,
            ),
            helper.make_node(
                "Slice",
                [spectrum_name, f"{branch_name}_start", f"{branch_name}_end", axes_name],
                [real_slice_name],
            ),
            helper.make_node(
                "Slice",
                [spectrum_name, f"{branch_name}_end", f"{branch_name}_complex_end", axes_name],
                [imag_slice_name],
            ),
            helper.make_node("Squeeze", [real_slice_name, axes_name], [real_name]),
            helper.make_node("Squeeze", [imag_slice_name, axes_name], [imag_name]),
        ]
    )
    return spectrum_name, real_name, imag_name


def add_complex_magnitude(
    nodes: list[onnx.NodeProto],
    prefix: str,
    real_name: str,
    imag_name: str,
    basis_real_name: str,
    basis_imag_name: str,
) -> str:
    output_name = f"{prefix}_magnitude"
    names = {
        "re_re": f"{prefix}_re_re",
        "im_im": f"{prefix}_im_im",
        "re": f"{prefix}_re",
        "re_im": f"{prefix}_re_im",
        "im_re": f"{prefix}_im_re",
        "im": f"{prefix}_im",
        "re_sq": f"{prefix}_re_sq",
        "im_sq": f"{prefix}_im_sq",
        "power": f"{prefix}_power",
    }
    nodes.extend(
        [
            helper.make_node("MatMul", [real_name, basis_real_name], [names["re_re"]]),
            helper.make_node("MatMul", [imag_name, basis_imag_name], [names["im_im"]]),
            helper.make_node("Sub", [names["re_re"], names["im_im"]], [names["re"]]),
            helper.make_node("MatMul", [real_name, basis_imag_name], [names["re_im"]]),
            helper.make_node("MatMul", [imag_name, basis_real_name], [names["im_re"]]),
            helper.make_node("Add", [names["re_im"], names["im_re"]], [names["im"]]),
            helper.make_node("Mul", [names["re"], names["re"]], [names["re_sq"]]),
            helper.make_node("Mul", [names["im"], names["im"]], [names["im_sq"]]),
            helper.make_node("Add", [names["re_sq"], names["im_sq"]], [names["power"]]),
            helper.make_node("Sqrt", [names["power"]], [output_name]),
        ]
    )
    return output_name


def add_frame_min(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    prefix: str,
    tensors: list[str],
    dimension_axis: int = 1,
) -> str:
    shape_names = []
    dimensions = []
    index_name = f"{prefix}_frame_index"
    initializers.append(
        numpy_helper.from_array(
            np.array([dimension_axis], dtype=np.int64),
            index_name,
        )
    )
    for index, tensor_name in enumerate(tensors):
        shape_name = f"{prefix}_shape_{index}"
        dimension_name = f"{prefix}_dimension_{index}"
        nodes.append(helper.make_node("Shape", [tensor_name], [shape_name]))
        nodes.append(
            helper.make_node(
                "Gather",
                [shape_name, index_name],
                [dimension_name],
                axis=0,
            )
        )
        shape_names.append(shape_name)
        dimensions.append(dimension_name)
    dimensions_name = f"{prefix}_dimensions"
    minimum_name = f"{prefix}_minimum"
    nodes.append(helper.make_node("Concat", dimensions, [dimensions_name], axis=0))
    nodes.append(
        helper.make_node(
            "ReduceMin",
            [dimensions_name],
            [minimum_name],
            axes=[0],
            keepdims=1,
        )
    )
    return minimum_name


def add_slice_frames(
    nodes: list[onnx.NodeProto],
    initializers: list[onnx.TensorProto],
    prefix: str,
    input_name: str,
    output_name: str,
    frame_count_name: str,
    axis: int = 0,
) -> None:
    start_name = f"{prefix}_slice_start"
    axes_name = f"{prefix}_slice_axes"
    initializers.extend(
        [
            numpy_helper.from_array(np.array([0], dtype=np.int64), start_name),
            numpy_helper.from_array(np.array([axis], dtype=np.int64), axes_name),
        ]
    )
    nodes.append(
        helper.make_node(
            "Slice",
            [input_name, start_name, frame_count_name, axes_name],
            [output_name],
        )
    )


def build_model() -> onnx.ModelProto:
    frequencies = cqt_frequencies(N_BINS, FMIN, BINS_PER_OCTAVE)
    alpha = relative_bandwidth(frequencies)
    lengths, _ = wavelet_lengths(frequencies, SR, alpha)
    pseudo_filters = np.array(
        [
            next_power_of_two(length) < 2 * HOP_LENGTH
            for length in lengths
        ],
        dtype=bool,
    )
    pseudo_count = int(pseudo_filters.sum())
    full_count = N_BINS - pseudo_count
    if pseudo_count == 0:
        raise ValueError("Expected at least one pseudo-CQT bin")

    full_frequencies = cqt_frequencies(full_count, FMIN, BINS_PER_OCTAVE)
    full_alpha = relative_bandwidth(full_frequencies)
    full_lengths, full_cutoff = wavelet_lengths(
        full_frequencies,
        SR,
        full_alpha,
    )

    nyquist = SR / 2
    octave_count = math.ceil(full_count / BINS_PER_OCTAVE)
    filters_per_octave = min(BINS_PER_OCTAVE, full_count)
    downsample_by_nyquist = max(
        0,
        math.ceil(math.log2(nyquist / full_cutoff)) - 2,
    )

    def num_two_factors(value: int) -> int:
        count = 0
        while value > 0 and value % 2 == 0:
            count += 1
            value //= 2
        return count

    downsample_by_hop = max(
        0,
        num_two_factors(HOP_LENGTH) - octave_count + 1,
    )
    early_downsample_count = min(downsample_by_nyquist, downsample_by_hop)

    nodes: list[onnx.NodeProto] = []
    initializers: list[onnx.TensorProto] = []

    pseudo_frequencies = cqt_frequencies(
        pseudo_count,
        float(np.min(frequencies[pseudo_filters])),
        BINS_PER_OCTAVE,
    )
    pseudo_alpha = (
        et_relative_bandwidth(BINS_PER_OCTAVE)
        if pseudo_count == 1
        else relative_bandwidth(pseudo_frequencies)
    )
    pseudo_real, pseudo_imag, pseudo_n_fft = vqt_filter_fft(
        pseudo_frequencies,
        SR,
        pseudo_alpha,
        HOP_LENGTH,
    )
    pseudo_lengths, _ = wavelet_lengths(pseudo_frequencies, SR, pseudo_alpha)
    pseudo_scale = (
        np.full(pseudo_count, 1 / math.sqrt(pseudo_n_fft))
        if SCALE
        else np.sqrt(pseudo_lengths / pseudo_n_fft)
    )
    pseudo_basis = np.hypot(pseudo_real, pseudo_imag).T.astype(np.float32)
    initializers.append(
        numpy_helper.from_array(pseudo_basis, "pseudo_basis")
    )
    initializers.append(
        numpy_helper.from_array(pseudo_scale.astype(np.float32), "pseudo_scale")
    )
    initializers.append(
        numpy_helper.from_array(
            hann_window(pseudo_n_fft).astype(np.float32),
            "pseudo_window",
        )
    )
    _, pseudo_real_name, pseudo_imag_name = add_stft_branch(
        nodes,
        initializers,
        "pseudo_signal",
        "pseudo",
        pseudo_n_fft,
        HOP_LENGTH,
        "pseudo_window",
    )
    nodes.extend(
        [
            helper.make_node("Mul", [pseudo_real_name, pseudo_real_name], ["pseudo_re_sq"]),
            helper.make_node("Mul", [pseudo_imag_name, pseudo_imag_name], ["pseudo_im_sq"]),
            helper.make_node("Add", ["pseudo_re_sq", "pseudo_im_sq"], ["pseudo_power"]),
            helper.make_node("Sqrt", ["pseudo_power"], ["pseudo_magnitude"]),
            helper.make_node("MatMul", ["pseudo_magnitude", "pseudo_basis"], ["pseudo_batch"]),
            helper.make_node("Mul", ["pseudo_batch", "pseudo_scale"], ["pseudo_scaled"]),
        ]
    )
    pseudo_squeeze_axis = "pseudo_squeeze_axis"
    initializers.append(
        numpy_helper.from_array(np.array([0], dtype=np.int64), pseudo_squeeze_axis)
    )
    nodes.append(
        helper.make_node(
            "Squeeze",
            ["pseudo_scaled", pseudo_squeeze_axis],
            ["pseudo_output"],
        )
    )

    full_signal = "full_signal_0"
    full_hop = HOP_LENGTH // (2**early_downsample_count)
    full_sample_rate = SR / (2**early_downsample_count)
    full_branches: list[
        tuple[str, str, np.ndarray, np.ndarray, np.ndarray, int]
    ] = []

    for index in range(octave_count):
        start = (
            full_count - filters_per_octave
            if index == 0
            else max(0, full_count - filters_per_octave * (index + 1))
        )
        end = (
            full_count
            if index == 0
            else full_count - filters_per_octave * index
        )
        branch_real, branch_imag, branch_n_fft = vqt_filter_fft(
            full_frequencies[start:end],
            full_sample_rate,
            full_alpha[start:end],
        )
        scale_factor = math.sqrt(SR / full_sample_rate)
        branch_real = branch_real * scale_factor
        branch_imag = branch_imag * scale_factor
        branch_length_scale = (
            1 / np.sqrt(full_lengths[start:end])
            if SCALE
            else np.ones(end - start)
        )
        branch_real = np.pad(
            branch_real,
            ((0, filters_per_octave - branch_real.shape[0]), (0, 0)),
        )
        branch_imag = np.pad(
            branch_imag,
            ((0, filters_per_octave - branch_imag.shape[0]), (0, 0)),
        )

        if full_branches:
            expected_n_fft = full_branches[0][5]
            if branch_n_fft != expected_n_fft:
                raise ValueError(
                    f"Full CQT branch FFT sizes differ: {expected_n_fft} and {branch_n_fft}"
                )

        _, branch_real_name, branch_imag_name = add_stft_branch(
            nodes,
            initializers,
            full_signal,
            f"full_{index}",
            branch_n_fft,
            full_hop,
            "full_window",
        )
        full_branches.append(
            (
                branch_real_name,
                branch_imag_name,
                branch_real,
                branch_imag,
                branch_length_scale,
                branch_n_fft,
            )
        )

        if index + 1 < octave_count and full_hop % 2 == 0:
            full_signal = f"full_signal_{index + 1}"
            full_hop //= 2
            full_sample_rate /= 2

    if not full_branches:
        raise ValueError("Expected at least one full-CQT branch")

    full_n_fft = full_branches[0][5]
    initializers.append(
        numpy_helper.from_array(
            np.ones(full_n_fft, dtype=np.float32),
            "full_window",
        )
    )

    frame_minimum = add_frame_min(
        nodes,
        initializers,
        "full",
        [branch[0] for branch in full_branches],
    )
    sliced_spectra = []
    for index, (real_name, imag_name, _, _, _, _) in enumerate(full_branches):
        real_output = f"full_{index}_real_sliced"
        imag_output = f"full_{index}_imag_sliced"
        add_slice_frames(
            nodes,
            initializers,
            f"full_{index}_real",
            real_name,
            real_output,
            frame_minimum,
            axis=1,
        )
        add_slice_frames(
            nodes,
            initializers,
            f"full_{index}_imag",
            imag_name,
            imag_output,
            frame_minimum,
            axis=1,
        )
        sliced_spectra.append((real_output, imag_output))

    # Reverse high-to-low octave branches so the final bins are low-to-high.
    sliced_spectra.reverse()
    full_basis_real = np.stack(
        [branch[2] for branch in reversed(full_branches)]
    )[:, :, :].transpose(0, 2, 1)
    full_basis_imag = np.stack(
        [branch[3] for branch in reversed(full_branches)]
    )[:, :, :].transpose(0, 2, 1)
    full_length_scales = np.stack(
        [
            np.pad(
                branch[4],
                (0, filters_per_octave - branch[4].shape[0]),
            )
            for branch in reversed(full_branches)
        ]
    ).astype(np.float32)

    min_frequency_bins = full_basis_real.shape[1]
    expected_frequency_bins = full_n_fft // 2 + 1
    if min_frequency_bins != expected_frequency_bins:
        raise ValueError(
            f"Unexpected full CQT basis size {min_frequency_bins}, "
            f"expected {expected_frequency_bins}"
        )
    initializers.extend(
        [
            numpy_helper.from_array(
                full_basis_real.astype(np.float32),
                "full_basis_real",
            ),
            numpy_helper.from_array(
                full_basis_imag.astype(np.float32),
                "full_basis_imag",
            ),
            numpy_helper.from_array(
                np.array([1] * octave_count, dtype=np.int64),
                "full_branch_splits",
            ),
            numpy_helper.from_array(np.array([1], dtype=np.int64), "full_branch_axis"),
            numpy_helper.from_array(np.array([0], dtype=np.int64), "full_bin_start"),
            numpy_helper.from_array(
                np.array([full_count - filters_per_octave * (octave_count - 1)], dtype=np.int64),
                "full_last_bin_end",
            ),
            numpy_helper.from_array(np.array([1], dtype=np.int64), "full_bin_axis"),
        ]
    )

    full_real_concat = "full_real_concat"
    full_imag_concat = "full_imag_concat"
    nodes.extend(
        [
            helper.make_node(
                "Concat",
                [item[0] for item in sliced_spectra],
                [full_real_concat],
                axis=0,
            ),
            helper.make_node(
                "Concat",
                [item[1] for item in sliced_spectra],
                [full_imag_concat],
                axis=0,
            ),
        ]
    )
    full_magnitude = add_complex_magnitude(
        nodes,
        "full",
        full_real_concat,
        full_imag_concat,
        "full_basis_real",
        "full_basis_imag",
    )
    nodes.extend(
        [
            helper.make_node(
                "Transpose",
                [full_magnitude],
                ["full_magnitude_transposed"],
                perm=[1, 0, 2],
            ),
            helper.make_node(
                "Split",
                ["full_magnitude_transposed", "full_branch_splits"],
                [f"full_branch_{index}" for index in range(octave_count)],
                axis=1,
            ),
        ]
    )
    branch_outputs = []
    for index in range(octave_count):
        squeezed_name = f"full_branch_{index}_squeezed"
        scaled_name = f"full_branch_{index}_scaled"
        final_name = f"full_branch_{index}_output"
        nodes.append(
            helper.make_node(
                "Squeeze",
                [f"full_branch_{index}", "full_branch_axis"],
                [squeezed_name],
            )
        )
        scale_name = f"full_branch_{index}_scale"
        initializers.append(
            numpy_helper.from_array(
                full_length_scales[index],
                scale_name,
            )
        )
        nodes.append(
            helper.make_node(
                "Mul",
                [squeezed_name, scale_name],
                [scaled_name],
            )
        )
        if index == 0:
            nodes.append(
                helper.make_node(
                    "Slice",
                    [scaled_name, "full_bin_start", "full_last_bin_end", "full_bin_axis"],
                    [final_name],
                )
            )
        else:
            nodes.append(
                helper.make_node(
                    "Identity",
                    [scaled_name],
                    [final_name],
                )
            )
        branch_outputs.append(final_name)
    nodes.append(
        helper.make_node(
            "Concat",
            branch_outputs,
            ["full_output"],
            axis=1,
        )
    )

    final_frame_minimum = add_frame_min(
        nodes,
        initializers,
        "final",
        ["full_output", "pseudo_output"],
        dimension_axis=0,
    )
    add_slice_frames(
        nodes,
        initializers,
        "full_output",
        "full_output",
        "full_output_final",
        final_frame_minimum,
    )
    add_slice_frames(
        nodes,
        initializers,
        "pseudo_output",
        "pseudo_output",
        "pseudo_output_final",
        final_frame_minimum,
    )
    nodes.append(
        helper.make_node(
            "Concat",
            ["full_output_final", "pseudo_output_final"],
            ["cqt"],
            axis=1,
        )
    )

    inputs = [
        helper.make_tensor_value_info(
            "pseudo_signal",
            TensorProto.FLOAT,
            [1, "pseudo_samples", 1],
        )
    ]
    inputs.extend(
        helper.make_tensor_value_info(
            f"full_signal_{index}",
            TensorProto.FLOAT,
            [1, f"full_samples_{index}", 1],
        )
        for index in range(octave_count)
    )
    outputs = [
        helper.make_tensor_value_info(
            "cqt",
            TensorProto.FLOAT,
            ["frames", N_BINS],
        )
    ]
    graph = helper.make_graph(
        nodes,
        "cqt_preprocess",
        inputs,
        outputs,
        initializers,
    )
    model = helper.make_model(
        graph,
        opset_imports=[helper.make_opsetid("", 17)],
        producer_name="chordmini-web",
        doc_string=(
            "Dynamic-shape hybrid CQT preprocessing for chordmini-web. "
            "Output is [frames, 288]."
        ),
    )
    model.metadata_props.extend(
        [
            onnx.StringStringEntryProto(key="sample_rate", value=str(SR)),
            onnx.StringStringEntryProto(key="hop_length", value=str(HOP_LENGTH)),
            onnx.StringStringEntryProto(key="bins", value=str(N_BINS)),
        ]
    )
    return model


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export the chordmini hybrid-CQT preprocessing graph to ONNX."
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
