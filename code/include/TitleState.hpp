#ifndef _TitleState_hpp_
#define _TitleState_hpp_

#include "State.hpp"
#include <libtcod.hpp>

class TitleState : public State
{
    public:
    TitleState(StateStack& stateStack);
    ~TitleState();

    void draw();
    bool update();
    bool handleInput(TCOD_key_t key);

  // needs menu items list
    private:
  
};

#endif // _TitleState_hpp_
