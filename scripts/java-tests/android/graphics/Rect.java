package android.graphics;

public class Rect {
    public int left;
    public int top;
    public int right;
    public int bottom;

    public Rect() {}

    public Rect(int left, int top, int right, int bottom) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;
    }

    public Rect(Rect other) {
        this(other.left, other.top, other.right, other.bottom);
    }

    public int width() {
        return right - left;
    }

    public int height() {
        return bottom - top;
    }

    public int centerY() {
        return (top + bottom) / 2;
    }

    public void union(Rect other) {
        left = Math.min(left, other.left);
        top = Math.min(top, other.top);
        right = Math.max(right, other.right);
        bottom = Math.max(bottom, other.bottom);
    }
}
