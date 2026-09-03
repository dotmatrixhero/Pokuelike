#ifndef _memutils_hpp_
#define _memutils_hpp_

/* make_unique as proposed by Stephen T Lavalej into the next std update.
   It has been confirmed to be in C++14.
   Some reference:
        http://stackoverflow.com/questions/7038357/make-unique-and-perfect-forwarding
        http://isocpp.org/blog/2013/04/trip-report-iso-c-spring-2013-meeting

        "Exception Save Function Calls":
        http://herbsutter.com/gotw/_102/
 */

#include <memory>
#include <type_traits>
#include <utility>

template <typename T, typename... Args>
std::unique_ptr<T> make_unique_helper(std::false_type, Args&&... args) {
  return std::unique_ptr<T>(new T(std::forward<Args>(args)...));
}

template <typename T, typename... Args>
std::unique_ptr<T> make_unique_helper(std::true_type, Args&&... args) {
   static_assert(std::extent<T>::value == 0,
       "make_unique<T[N]>() is forbidden, please use make_unique<T[]>().");

   typedef typename std::remove_extent<T>::type U;
   return std::unique_ptr<T>(new U[sizeof...(Args)]{std::forward<Args>(args)...});
}

template <typename T, typename... Args>
std::unique_ptr<T> make_unique(Args&&... args) {
   return make_unique_helper<T>(std::is_array<T>(), std::forward<Args>(args)...);
}

#endif // _memutils_hpp_
