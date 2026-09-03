#ifndef PARSERLISTENER_H
#define PARSERLISTENER_H
#include <libtcod/libtcod.hpp>
#include <iostream>
#include <fstream>

class ParserListener : public ITCODParserListener {

    public:

        bool parserNewStruct(TCODParser *parser,const TCODParserStruct *str,const char *name);
        bool parserFlag(TCODParser *parser,const char *name);
        bool parserProperty(TCODParser *parser,const char *name, TCOD_value_type_t type, TCOD_value_t value);
        bool parserEndStruct(TCODParser *parser,const TCODParserStruct *str,const char *name);
        void error(const char *msg);
        ParserListener();
        virtual ~ParserListener();
    protected:
    private:
};

#endif // PARSERLISTENER_H
