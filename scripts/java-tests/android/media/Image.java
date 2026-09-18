package android.media;

import java.nio.ByteBuffer;

public abstract class Image {
    public abstract Plane[] getPlanes();
    public abstract long getTimestamp();

    public abstract static class Plane {
        public abstract ByteBuffer getBuffer();
        public abstract int getPixelStride();
        public abstract int getRowStride();
    }
}
