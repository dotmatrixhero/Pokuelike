#ifndef ACTORPARSER_H
#define ACTORPARSER_H


class ActorParser public ITCODParserListener {

    public:

        bool parserNewStruct(TCODParser *parser,const TCODParserStruct *str,const char *name);
        bool parserFlag(TCODParser *parser,const char *name);
        bool parserProperty(TCODParser *parser,const char *name, TCOD_value_type_t type, TCOD_value_t value);
        bool parserEndStruct(TCODParser *parser,const TCODParserStruct *str,const char *name);
        void error(const char *msg);
        /** Default constructor */
        ActorParser();
        /** Default destructor */
        virtual ~ActorParser();
    protected:
    private:
};

#endif // ACTORPARSER_H
