import importlib.util, os

spec = importlib.util.spec_from_file_location("control", os.path.join(os.path.dirname(__file__), "control.py"))
control = importlib.util.module_from_spec(spec)
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


if __name__ == "__main__":
    test_safe_name_basename()
    test_safe_name_rejects_traversal()
    print("ok")
