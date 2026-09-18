import com.sun.source.util.JavacTask;
import java.nio.charset.StandardCharsets;
import java.util.List;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/** Parses Java sources without type attribution, useful before the Android SDK build. */
public final class JavaSyntaxCheck {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) throw new IllegalArgumentException("at least one Java source is required");

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("jdk.compiler is unavailable");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();

        try (StandardJavaFileManager files = compiler.getStandardFileManager(
            diagnostics,
            null,
            StandardCharsets.UTF_8
        )) {
            Iterable<? extends JavaFileObject> units = files.getJavaFileObjects(args);
            JavacTask task = (JavacTask) compiler.getTask(
                null,
                files,
                diagnostics,
                List.of("-encoding", "UTF-8", "-proc:none"),
                null,
                units
            );
            task.parse();
        }

        int errors = 0;
        for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
            if (diagnostic.getKind() != Diagnostic.Kind.ERROR) continue;
            errors++;
            String source = diagnostic.getSource() == null
                ? "<unknown>"
                : diagnostic.getSource().getName();
            System.err.println(
                source + ":" + diagnostic.getLineNumber() + ": "
                    + diagnostic.getMessage(null)
            );
        }
        if (errors > 0) throw new IllegalStateException(errors + " Java syntax error(s)");
        System.out.println("JavaSyntaxCheck: PASS (" + args.length + " sources)");
    }
}
