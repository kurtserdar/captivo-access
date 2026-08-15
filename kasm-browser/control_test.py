import importlib.util, os, sys

spec = importlib.util.spec_from_file_location("control", os.path.join(os.path.dirname(__file__), "control.py"))
control = importlib.util.module_from_spec(spec)
sys.modules["control"] = control  # so importlib.reload(control) works in the env tests
spec.loader.exec_module(control)


def test_safe_name_basename():
    assert control._safe_name("report.pdf") == "report.pdf"
    assert control._safe_name("/a/b/report.pdf") == "report.pdf"


def test_safe_name_rejects_traversal():
    assert control._safe_name("../../etc/passwd") == "passwd"
    assert control._safe_name("..") is None
    assert control._safe_name("") is None
    assert control._safe_name("   ") is None
    assert control._safe_name(".") is None


def test_ffmpeg_args_defaults():
    args = control._ffmpeg_args(3, "/rec/s.webm", 2560, 1600)
    assert "-vf" in args
    vf = args[args.index("-vf") + 1]
    assert vf == "scale='min(1280,iw)':-2"
    assert "-b:v" in args
    assert args[args.index("-b:v") + 1] == "512k"
    # unchanged essentials
    assert "libvpx" in args
    assert "-framerate" in args and args[args.index("-framerate") + 1] == "10"
    assert "realtime" in args
    # the filter must come before the tee muxer so both sinks are capped
    assert args.index("-vf") < args.index("tee")


def test_ffmpeg_args_env_overrides():
    import importlib, os
    os.environ["RECORDING_MAX_WIDTH"] = "1600"
    os.environ["RECORDING_VIDEO_BITRATE"] = "768k"
    importlib.reload(control)
    try:
        args = control._ffmpeg_args(3, "/rec/s.webm", 2560, 1600)
        assert args[args.index("-vf") + 1] == "scale='min(1600,iw)':-2"
        assert args[args.index("-b:v") + 1] == "768k"
    finally:
        del os.environ["RECORDING_MAX_WIDTH"]
        del os.environ["RECORDING_VIDEO_BITRATE"]
        importlib.reload(control)


def test_ffmpeg_args_env_fallbacks():
    import importlib, os
    os.environ["RECORDING_MAX_WIDTH"] = "bad"
    os.environ["RECORDING_VIDEO_BITRATE"] = "   "
    importlib.reload(control)
    try:
        assert control.RECORDING_MAX_WIDTH == 1280
        assert control.RECORDING_VIDEO_BITRATE == "512k"
    finally:
        del os.environ["RECORDING_MAX_WIDTH"]
        del os.environ["RECORDING_VIDEO_BITRATE"]
        importlib.reload(control)


def test_clamp_dim_floor():
    assert control._clamp_dim(100, 360, 2560, 1280) == 360
    assert control._clamp_dim(400, 360, 2560, 1280) == 400
    assert control._clamp_dim(None, 360, 2560, 1280) == 1280
    assert control._clamp_dim(480, 480, 1600, 800) == 480


if __name__ == "__main__":
    test_safe_name_basename()
    test_safe_name_rejects_traversal()
    test_ffmpeg_args_defaults()
    test_ffmpeg_args_env_overrides()
    test_ffmpeg_args_env_fallbacks()
    test_clamp_dim_floor()
    print("ok")
