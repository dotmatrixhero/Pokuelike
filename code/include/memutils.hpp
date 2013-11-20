#ifndef _memutils_hpp_
#define _memutils_hpp_

#include <memory>

template<typename T, typename ...Args>
std::unique_ptr<T> make_unique(Args&& ...args)
{
    return std::unique_ptr<T>(new T(std::forward<Args>(args)...));
}

#endif // _memutils_hpp_
