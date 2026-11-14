import javax.tools.*;import com.sun.source.util.*;import java.util.*;
public class ParseNativeSources {
 public static void main(String[] args)throws Exception{
  var compiler=ToolProvider.getSystemJavaCompiler();var diagnostics=new DiagnosticCollector<JavaFileObject>();
  try(var manager=compiler.getStandardFileManager(diagnostics,null,null)){
   var files=manager.getJavaFileObjectsFromStrings(Arrays.asList(args));
   var task=(JavacTask)compiler.getTask(null,manager,diagnostics,List.of("-proc:none"),null,files);
   task.parse();
   for(var d:diagnostics.getDiagnostics())if(d.getKind()==Diagnostic.Kind.ERROR)throw new AssertionError(d);
   System.out.println("Native Java syntax: PASS "+args.length+" files");
  }
 }
}
