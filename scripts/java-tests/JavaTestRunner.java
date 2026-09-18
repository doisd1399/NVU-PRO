import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class JavaTestRunner {
    public static void main(String[] args) throws Exception {
        if (args.length < 3) throw new IllegalArgumentException("usage: JavaTestRunner <outputDir> <mainClass> <sources...>");
        File outputDir = new File(args[0]);
        if (!outputDir.mkdirs() && !outputDir.isDirectory()) throw new IllegalStateException("cannot create output directory");
        List<String> sourceFiles = new ArrayList<>();
        sourceFiles.addAll(Arrays.asList(args).subList(2, args.length));
        List<String> javac = new ArrayList<>();
        javac.add("javac");
        javac.add("-encoding");
        javac.add("UTF-8");
        javac.add("-d");
        javac.add(outputDir.getAbsolutePath());
        javac.addAll(sourceFiles);
        Process compile = new ProcessBuilder(javac).inheritIO().start();
        int compileStatus = compile.waitFor();
        if (compileStatus != 0) throw new IllegalStateException("javac failed: " + compileStatus);
        URLClassLoader loader = new URLClassLoader(new URL[] {outputDir.toURI().toURL()});
        Class<?> testClass = Class.forName(args[1], true, loader);
        testClass.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
    }
}
