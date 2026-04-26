{pkgs}: {
  deps = [
    pkgs.flutter
    pkgs.llvmPackages.libclang
    pkgs.clang
  ];
}
