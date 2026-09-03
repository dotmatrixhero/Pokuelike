#ifndef _Log_hpp_
#define _Log_hpp_

#include <string>

#if defined(DEBUG)
#define pAssert(x,y) if(!(x)){ failedAssert(#x, y, __FILE__, __LINE__); }
void failedAssert(const std::string& condition,
                  const std::string& message,
                  const char* file,
                  int line);
#else
#define pAssert(x,y) {}
#endif

void logf(const char* format, ...);
void log(const std::string& str);

#endif // _Log_hpp_
