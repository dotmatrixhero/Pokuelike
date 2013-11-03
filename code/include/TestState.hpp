#ifndef _TestState_hpp_
#define _TestState_hpp_

#include "State.hpp"

class TestState : public State
{
    public:
    TestState(StateStack& stateStack);
    ~TestState();

    bool draw();
    bool update();
    bool handleInput();
};

#endif // _TestState_hpp_

