#ifndef _Application_hpp_
#define _Application_hpp_

#include <libtcod.hpp>
#include "StateStack.hpp"
#include "StateIdentifiers.hpp"

class Application
{
    public:
    Application();
    Application(const std::string& filename);
    void run(States::ID stateId);

    private:
    void registerStates();

    private:
    StateStack stateStack;
    bool quit;

    static const int DEFAULT_WIDTH  = 80;
    static const int DEFAULT_HEIGHT = 60;
};

#endif // _Application_hpp_
