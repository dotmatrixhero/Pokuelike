#include "../include/Log.hpp"

#include <cstdio>
#include <cstdarg>

void failedAssert(const std::string& condition,
                  const std::string message,
                  const char* file,
                  int line)
{
    logf(" ## Failed Assertion ##");
    logf("Condition: (%s)", condition.c_str());
    logf("Assertion: %s", message.c_str());
    logf("At: %s:%d", file, line);
    exit(1);
}

void logf(const char *format, ...)
{
    char sz[1024];
    va_list marker;

    va_start(marker, format);
    vsprintf(sz, format, marker);
    va_end(marker);

    std::string str = sz;

    log(str);
}

void log(const std::string& str)
{
    fprintf(stdout, "%s\n", str.c_str() );
}
